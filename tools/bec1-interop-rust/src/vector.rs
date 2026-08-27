use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    constants::{CONTENT_INFO, DESCRIPTOR_SIZE, HEADER_AUTH_INFO, MANIFEST_INFO},
    crypto::{
        derive_recovery_kek, derive_subkey, encrypt_aes_gcm, normalize_password, wrap_key,
        KdfParameters,
    },
    error::{Bec1Error, Result},
    format::{
        build_descriptor, create_asset_salt, create_chunk_aad_from_fields, create_chunk_nonce,
        create_file_wrap_info, create_manifest_aad, DescriptorBuildInput,
    },
    manifest::{encode_recovery_manifest, RecoveryMetadataInput},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InteropVector {
    password_code_points: Vec<u32>,
    normalized_password_utf8_hex: String,
    library_id: String,
    asset_id: String,
    master_key_hex: String,
    file_key_hex: String,
    kdf_salt_hex: String,
    nonce_prefix_hex: String,
    manifest_nonce_hex: String,
    kdf: VectorKdf,
    plaintext: VectorPlaintext,
    chunk_size: u32,
    recovery: RecoveryMetadataInput,
    expected: VectorExpected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorKdf {
    #[serde(rename = "memoryKiB")]
    memory_kib: u32,
    passes: u32,
    parallelism: u32,
    tag_length: u16,
    version: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorPlaintext {
    length: usize,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorExpected {
    recovery_kek_hex: String,
    wrapped_master_key_hex: String,
    container_size: usize,
    container_sha256: String,
    descriptor_sha256: String,
    first_chunk_sha256: String,
    final_chunk_sha256: String,
}

pub fn emit_vector(vector_path: &Path, output_path: &Path) -> Result<()> {
    let vector: InteropVector = serde_json::from_slice(&fs::read(vector_path)?)?;
    let mut container = build_vector(&vector)?;
    let temporary_path = create_temporary_path(output_path)?;
    let result = (|| {
        let mut file = open_new_private_file(&temporary_path)?;
        file.write_all(&container)?;
        file.flush()?;
        file.sync_all()?;
        fs::hard_link(&temporary_path, output_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                Bec1Error::new(
                    "OUTPUT_EXISTS",
                    format!("Output already exists: {}", output_path.display()),
                )
            } else {
                error.into()
            }
        })?;
        Ok(())
    })();
    let _ = fs::remove_file(&temporary_path);
    container.zeroize();
    result
}

fn build_vector(vector: &InteropVector) -> Result<Vec<u8>> {
    let password = Zeroizing::new(
        vector
            .password_code_points
            .iter()
            .map(|code_point| {
                char::from_u32(*code_point)
                    .ok_or_else(|| Bec1Error::new("INVALID_INPUT", "Invalid password code point."))
            })
            .collect::<Result<String>>()?,
    );
    if hex::encode(normalize_password(&password).as_bytes()) != vector.normalized_password_utf8_hex
    {
        return Err(Bec1Error::new(
            "VECTOR_MISMATCH",
            "Password normalization does not match the vector.",
        ));
    }

    let library_id = *Uuid::parse_str(&vector.library_id)
        .map_err(|error| Bec1Error::new("INVALID_INPUT", error.to_string()))?
        .as_bytes();
    let asset_id = *Uuid::parse_str(&vector.asset_id)
        .map_err(|error| Bec1Error::new("INVALID_INPUT", error.to_string()))?
        .as_bytes();
    let master_key = Zeroizing::new(decode_fixed::<32>(&vector.master_key_hex, "master key")?);
    let file_key = Zeroizing::new(decode_fixed::<32>(&vector.file_key_hex, "file key")?);
    let kdf_salt = decode_fixed::<16>(&vector.kdf_salt_hex, "KDF salt")?;
    let nonce_prefix = decode_fixed::<8>(&vector.nonce_prefix_hex, "nonce prefix")?;
    let manifest_nonce = decode_fixed::<12>(&vector.manifest_nonce_hex, "manifest nonce")?;
    let kdf = KdfParameters {
        algorithm: "argon2id",
        version: vector.kdf.version,
        memory_kib: vector.kdf.memory_kib,
        passes: vector.kdf.passes,
        parallelism: vector.kdf.parallelism,
        tag_length: vector.kdf.tag_length,
    };
    let recovery_kek = derive_recovery_kek(&password, &kdf_salt, &kdf)?;
    assert_hex(
        recovery_kek.as_ref(),
        &vector.expected.recovery_kek_hex,
        "Recovery KEK",
    )?;
    let wrapped_master_key = wrap_key(recovery_kek.as_ref(), master_key.as_ref())?;
    assert_hex(
        &wrapped_master_key,
        &vector.expected.wrapped_master_key_hex,
        "wrapped master key",
    )?;

    let header_auth_key = derive_subkey(master_key.as_ref(), &library_id, HEADER_AUTH_INFO)?;
    let file_wrap_info = create_file_wrap_info(&asset_id);
    let file_wrapping_key = derive_subkey(master_key.as_ref(), &library_id, &file_wrap_info)?;
    let wrapped_file_key = wrap_key(file_wrapping_key.as_ref(), file_key.as_ref())?;
    let asset_salt = create_asset_salt(&library_id, &asset_id);
    let content_key = derive_subkey(file_key.as_ref(), &asset_salt, CONTENT_INFO)?;
    let manifest_key = derive_subkey(file_key.as_ref(), &asset_salt, MANIFEST_INFO)?;

    let mut plaintext = Zeroizing::new(vec![0_u8; vector.plaintext.length]);
    for (index, value) in plaintext.iter_mut().enumerate() {
        *value = (index.wrapping_mul(73).wrapping_add(41) & 0xff) as u8;
    }
    let plaintext_digest: [u8; 32] = Sha256::digest(plaintext.as_slice()).into();
    assert_hex(
        &plaintext_digest,
        &vector.plaintext.sha256,
        "plaintext digest",
    )?;
    let manifest_plaintext =
        encode_recovery_manifest(&vector.recovery, "vector.bin", &plaintext_digest)?;
    let manifest_aad = create_manifest_aad(&library_id, &asset_id);
    let manifest_ciphertext = encrypt_aes_gcm(
        &manifest_plaintext,
        manifest_key.as_ref(),
        &manifest_nonce,
        &manifest_aad,
    )?;
    let descriptor = build_descriptor(&DescriptorBuildInput {
        generation: 1,
        library_id,
        asset_id,
        plaintext_size: plaintext.len() as u64,
        chunk_size: vector.chunk_size,
        nonce_prefix,
        kdf: &kdf,
        kdf_salt,
        wrapped_master_key: &wrapped_master_key,
        wrapped_file_key: &wrapped_file_key,
        manifest_nonce,
        manifest_ciphertext: &manifest_ciphertext,
        manifest_plaintext_length: u32::try_from(manifest_plaintext.len())
            .map_err(|_| Bec1Error::invalid("The vector manifest is too large."))?,
        header_auth_key: header_auth_key.as_ref(),
    })?;

    let mut chunks = Vec::new();
    for (index, chunk) in plaintext.chunks(vector.chunk_size as usize).enumerate() {
        let index = u32::try_from(index)
            .map_err(|_| Bec1Error::unsafe_parameters("The vector has too many chunks."))?;
        let nonce = create_chunk_nonce(&nonce_prefix, index);
        let aad = create_chunk_aad_from_fields(
            library_id,
            asset_id,
            plaintext.len() as u64,
            vector.chunk_size,
            index,
            chunk.len() as u32,
        );
        chunks.extend_from_slice(&encrypt_aes_gcm(chunk, content_key.as_ref(), &nonce, &aad)?);
    }

    let mut container = Vec::with_capacity(descriptor.len() * 2 + chunks.len());
    container.extend_from_slice(&descriptor);
    container.extend_from_slice(&chunks);
    container.extend_from_slice(&descriptor);
    validate_expected_output(vector, &container, &descriptor)?;
    Ok(container)
}

fn validate_expected_output(
    vector: &InteropVector,
    container: &[u8],
    descriptor: &[u8],
) -> Result<()> {
    if container.len() != vector.expected.container_size {
        return Err(Bec1Error::new(
            "VECTOR_MISMATCH",
            "The container size does not match the vector.",
        ));
    }
    assert_hex(
        &Sha256::digest(container),
        &vector.expected.container_sha256,
        "container digest",
    )?;
    assert_hex(
        &Sha256::digest(descriptor),
        &vector.expected.descriptor_sha256,
        "descriptor digest",
    )?;
    let first_chunk_length = vector.chunk_size as usize + 16;
    assert_hex(
        &Sha256::digest(&container[DESCRIPTOR_SIZE..DESCRIPTOR_SIZE + first_chunk_length]),
        &vector.expected.first_chunk_sha256,
        "first chunk digest",
    )?;
    assert_hex(
        &Sha256::digest(
            &container[DESCRIPTOR_SIZE + first_chunk_length..container.len() - DESCRIPTOR_SIZE],
        ),
        &vector.expected.final_chunk_sha256,
        "final chunk digest",
    )?;
    Ok(())
}

fn decode_fixed<const LENGTH: usize>(value: &str, field: &str) -> Result<[u8; LENGTH]> {
    let bytes =
        hex::decode(value).map_err(|error| Bec1Error::new("INVALID_INPUT", error.to_string()))?;
    bytes.try_into().map_err(|_| {
        Bec1Error::new(
            "INVALID_INPUT",
            format!("The {field} must contain {LENGTH} bytes."),
        )
    })
}

fn assert_hex(actual: &[u8], expected: &str, field: &str) -> Result<()> {
    if hex::encode(actual) != expected {
        return Err(Bec1Error::new(
            "VECTOR_MISMATCH",
            format!("The {field} does not match the vector."),
        ));
    }
    Ok(())
}

fn create_temporary_path(output_path: &Path) -> Result<PathBuf> {
    let directory = output_path.parent().unwrap_or_else(|| Path::new("."));
    for attempt in 0..1000_u32 {
        let candidate = directory.join(format!(
            ".bec1-vector-{}-{attempt}.part",
            std::process::id()
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(Bec1Error::new(
        "IO_ERROR",
        "Unable to allocate a temporary vector path.",
    ))
}

fn open_new_private_file(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(Into::into)
}
