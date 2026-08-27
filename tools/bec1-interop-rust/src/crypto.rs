use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    aes::cipher::consts::U12,
    Aes256Gcm, Nonce,
};
use aes_kw::KekAes256;
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit as HmacKeyInit, Mac};
use serde::Serialize;
use sha2::Sha256;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::{
    constants::{
        KEY_SIZE, MAX_KDF_MEMORY_KIB, MAX_KDF_PARALLELISM, MAX_KDF_PASSES, MIN_KDF_MEMORY_KIB,
        MIN_KDF_PASSES,
    },
    error::{Bec1Error, Result},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParameters {
    pub algorithm: &'static str,
    pub version: u8,
    #[serde(rename = "memoryKiB")]
    pub memory_kib: u32,
    pub passes: u32,
    pub parallelism: u32,
    pub tag_length: u16,
}

impl KdfParameters {
    pub fn validate(&self) -> Result<()> {
        if self.version != 0x13 || self.tag_length != KEY_SIZE as u16 {
            return Err(Bec1Error::new(
                "UNSUPPORTED_VERSION",
                "The container uses an unsupported password KDF.",
            ));
        }
        if self.parallelism == 0
            || self.parallelism > MAX_KDF_PARALLELISM
            || self.passes < MIN_KDF_PASSES
            || self.passes > MAX_KDF_PASSES
            || self.memory_kib < MIN_KDF_MEMORY_KIB.max(8 * self.parallelism)
            || self.memory_kib > MAX_KDF_MEMORY_KIB
        {
            return Err(Bec1Error::unsafe_parameters(
                "The container declares unsafe Argon2id parameters.",
            ));
        }
        Ok(())
    }
}

pub fn normalize_password(password: &str) -> String {
    password.nfc().collect()
}

pub fn derive_recovery_kek(
    password: &str,
    salt: &[u8],
    kdf: &KdfParameters,
) -> Result<Zeroizing<[u8; KEY_SIZE]>> {
    kdf.validate()?;
    let normalized = Zeroizing::new(normalize_password(password));
    let parameters = Params::new(kdf.memory_kib, kdf.passes, kdf.parallelism, Some(KEY_SIZE))
        .map_err(|error| Bec1Error::unsafe_parameters(error.to_string()))?;
    let algorithm = Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters);
    let mut output = Zeroizing::new([0_u8; KEY_SIZE]);
    algorithm
        .hash_password_into(normalized.as_bytes(), salt, output.as_mut())
        .map_err(|error| Bec1Error::unsafe_parameters(error.to_string()))?;
    Ok(output)
}

pub fn derive_subkey(key: &[u8], salt: &[u8], info: &[u8]) -> Result<Zeroizing<[u8; KEY_SIZE]>> {
    let hkdf = Hkdf::<Sha256>::new(Some(salt), key);
    let mut output = Zeroizing::new([0_u8; KEY_SIZE]);
    hkdf.expand(info, output.as_mut())
        .map_err(|_| Bec1Error::invalid("HKDF output length is invalid."))?;
    Ok(output)
}

pub fn wrap_key(wrapping_key: &[u8], raw_key: &[u8]) -> Result<Vec<u8>> {
    let kek = KekAes256::try_from(wrapping_key)
        .map_err(|_| Bec1Error::invalid("AES-KW key length is invalid."))?;
    kek.wrap_vec(raw_key)
        .map_err(|_| Bec1Error::authentication())
}

pub fn unwrap_key(wrapping_key: &[u8], wrapped_key: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    let kek = KekAes256::try_from(wrapping_key).map_err(|_| Bec1Error::authentication())?;
    let output = kek
        .unwrap_vec(wrapped_key)
        .map_err(|_| Bec1Error::authentication())?;
    if output.len() != KEY_SIZE {
        return Err(Bec1Error::authentication());
    }
    Ok(Zeroizing::new(output))
}

pub fn encrypt_aes_gcm(plaintext: &[u8], key: &[u8], nonce: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    if nonce.len() != 12 {
        return Err(Bec1Error::invalid("AES-GCM nonce length is invalid."));
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| Bec1Error::invalid("AES key is invalid."))?;
    let nonce = Nonce::<U12>::try_from(nonce)
        .map_err(|_| Bec1Error::invalid("AES-GCM nonce length is invalid."))?;
    cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| Bec1Error::authentication())
}

pub fn decrypt_aes_gcm(
    ciphertext_and_tag: &[u8],
    key: &[u8],
    nonce: &[u8],
    aad: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    if nonce.len() != 12 || ciphertext_and_tag.len() < 16 {
        return Err(Bec1Error::authentication());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| Bec1Error::authentication())?;
    let nonce = Nonce::<U12>::try_from(nonce).map_err(|_| Bec1Error::authentication())?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext_and_tag,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| Bec1Error::authentication())
}

pub fn descriptor_mac(body: &[u8], key: &[u8]) -> Result<[u8; 32]> {
    let mut mac = <Hmac<Sha256> as HmacKeyInit>::new_from_slice(key)
        .map_err(|_| Bec1Error::invalid("HMAC key is invalid."))?;
    mac.update(body);
    Ok(mac.finalize().into_bytes().into())
}

pub fn verify_descriptor_mac(body: &[u8], expected: &[u8], key: &[u8]) -> Result<()> {
    let mut mac = <Hmac<Sha256> as HmacKeyInit>::new_from_slice(key)
        .map_err(|_| Bec1Error::authentication())?;
    mac.update(body);
    mac.verify_slice(expected)
        .map_err(|_| Bec1Error::authentication())
}
