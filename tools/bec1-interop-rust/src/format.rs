use serde::Serialize;
use uuid::Uuid;

use crate::{
    constants::{
        offset, CHUNK_AAD_MAGIC, DESCRIPTOR_BODY_SIZE, DESCRIPTOR_MAC_SIZE, DESCRIPTOR_SIZE,
        GCM_TAG_SIZE, KDF_SALT_SIZE, MAGIC, MANIFEST_AAD_PREFIX, MANIFEST_NONCE_SIZE,
        MANIFEST_OFFSET, MAX_CHUNK_SIZE, MIN_CHUNK_SIZE, NONCE_PREFIX_SIZE, SUITE, VERSION,
        WRAPPED_KEY_SIZE,
    },
    crypto::{descriptor_mac, KdfParameters},
    error::{Bec1Error, Result},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInfo {
    pub format: &'static str,
    pub version: u16,
    pub suite: u16,
    pub generation: u32,
    pub library_id: String,
    pub asset_id: String,
    pub plaintext_size: u64,
    pub chunk_size: u32,
    pub chunk_count: u32,
    pub encrypted_size: u64,
    pub kdf: KdfParameters,
}

#[derive(Clone, Debug)]
pub struct ParsedDescriptor {
    pub info: ContainerInfo,
    pub library_id: [u8; 16],
    pub asset_id: [u8; 16],
    pub kdf_salt: [u8; KDF_SALT_SIZE],
    pub wrapped_master_key: [u8; WRAPPED_KEY_SIZE],
    pub wrapped_file_key: [u8; WRAPPED_KEY_SIZE],
    pub nonce_prefix: [u8; NONCE_PREFIX_SIZE],
    pub manifest_nonce: [u8; MANIFEST_NONCE_SIZE],
    pub manifest_ciphertext: Vec<u8>,
    pub manifest_plaintext_length: u32,
    pub body: Vec<u8>,
    pub mac: [u8; DESCRIPTOR_MAC_SIZE],
}

pub struct DescriptorBuildInput<'a> {
    pub generation: u32,
    pub library_id: [u8; 16],
    pub asset_id: [u8; 16],
    pub plaintext_size: u64,
    pub chunk_size: u32,
    pub nonce_prefix: [u8; NONCE_PREFIX_SIZE],
    pub kdf: &'a KdfParameters,
    pub kdf_salt: [u8; KDF_SALT_SIZE],
    pub wrapped_master_key: &'a [u8],
    pub wrapped_file_key: &'a [u8],
    pub manifest_nonce: [u8; MANIFEST_NONCE_SIZE],
    pub manifest_ciphertext: &'a [u8],
    pub manifest_plaintext_length: u32,
    pub header_auth_key: &'a [u8],
}

pub fn calculate_chunk_count(plaintext_size: u64, chunk_size: u32) -> Result<u32> {
    if plaintext_size == 0 {
        return Ok(0);
    }
    let count = plaintext_size
        .checked_add(chunk_size as u64 - 1)
        .ok_or_else(|| Bec1Error::invalid("The plaintext size overflows chunk geometry."))?
        / chunk_size as u64;
    u32::try_from(count)
        .map_err(|_| Bec1Error::unsafe_parameters("The container has too many chunks."))
}

pub fn calculate_encrypted_size(plaintext_size: u64, chunk_count: u32) -> Result<u64> {
    (DESCRIPTOR_SIZE as u64 * 2)
        .checked_add(plaintext_size)
        .and_then(|value| value.checked_add(chunk_count as u64 * GCM_TAG_SIZE as u64))
        .ok_or_else(|| Bec1Error::invalid("The encrypted size overflows."))
}

pub fn parse_descriptor(source: &[u8], file_size: u64) -> Result<ParsedDescriptor> {
    if source.len() != DESCRIPTOR_SIZE {
        return Err(Bec1Error::invalid("A descriptor must contain 4096 bytes."));
    }
    if &source[..MAGIC.len()] != MAGIC {
        return Err(Bec1Error::invalid("The BEC1 magic value is invalid."));
    }
    if read_u16(source, offset::VERSION)? != VERSION
        || read_u16(source, offset::DESCRIPTOR_SIZE)? != DESCRIPTOR_SIZE as u16
        || read_u16(source, offset::SUITE)? != SUITE
    {
        return Err(Bec1Error::new(
            "UNSUPPORTED_VERSION",
            "The BEC1 version or cryptographic suite is unsupported.",
        ));
    }
    if read_u16(source, offset::FLAGS)? != 0
        || source[offset::RESERVED..offset::RESERVED + 16]
            .iter()
            .any(|value| *value != 0)
    {
        return Err(Bec1Error::new(
            "UNSUPPORTED_VERSION",
            "The BEC1 descriptor uses unsupported flags or fields.",
        ));
    }

    let generation = read_u32(source, offset::GENERATION)?;
    if generation == 0 {
        return Err(Bec1Error::invalid("The descriptor generation is invalid."));
    }
    let plaintext_size = read_u64(source, offset::PLAINTEXT_SIZE)?;
    let chunk_size = read_u32(source, offset::CHUNK_SIZE)?;
    validate_chunk_size(chunk_size)?;
    let chunk_count = read_u32(source, offset::CHUNK_COUNT)?;
    if calculate_chunk_count(plaintext_size, chunk_size)? != chunk_count {
        return Err(Bec1Error::invalid("The chunk geometry is inconsistent."));
    }
    let encrypted_size = calculate_encrypted_size(plaintext_size, chunk_count)?;
    if encrypted_size != file_size {
        return Err(Bec1Error::invalid(
            "The descriptor geometry does not match the file size.",
        ));
    }
    if source[offset::KDF_ID] != 1 || source[offset::KDF_VERSION] != 0x13 {
        return Err(Bec1Error::new(
            "UNSUPPORTED_VERSION",
            "The password KDF is unsupported.",
        ));
    }
    if read_u16(source, offset::KDF_SALT_LENGTH)? != KDF_SALT_SIZE as u16 {
        return Err(Bec1Error::invalid("The KDF salt length is invalid."));
    }
    let kdf = KdfParameters {
        algorithm: "argon2id",
        version: source[offset::KDF_VERSION],
        parallelism: read_u16(source, offset::KDF_PARALLELISM)? as u32,
        memory_kib: read_u32(source, offset::KDF_MEMORY_KIB)?,
        passes: read_u32(source, offset::KDF_PASSES)?,
        tag_length: read_u16(source, offset::KDF_TAG_LENGTH)?,
    };
    kdf.validate()?;

    let manifest_ciphertext_length = read_u32(source, offset::MANIFEST_CIPHERTEXT_LENGTH)? as usize;
    let manifest_plaintext_length = read_u32(source, offset::MANIFEST_PLAINTEXT_LENGTH)?;
    if manifest_ciphertext_length < GCM_TAG_SIZE
        || manifest_ciphertext_length != manifest_plaintext_length as usize + GCM_TAG_SIZE
    {
        return Err(Bec1Error::invalid(
            "The manifest ciphertext length is invalid.",
        ));
    }
    let manifest_end = MANIFEST_OFFSET
        .checked_add(manifest_ciphertext_length)
        .ok_or_else(|| Bec1Error::invalid("The manifest length overflows."))?;
    if manifest_end > DESCRIPTOR_BODY_SIZE {
        return Err(Bec1Error::invalid("The recovery manifest is too large."));
    }
    if source[manifest_end..DESCRIPTOR_BODY_SIZE]
        .iter()
        .any(|value| *value != 0)
    {
        return Err(Bec1Error::new(
            "UNSUPPORTED_VERSION",
            "The BEC1 descriptor has non-zero reserved bytes.",
        ));
    }

    let library_id = read_array::<16>(source, offset::LIBRARY_ID)?;
    let asset_id = read_array::<16>(source, offset::ASSET_ID)?;
    let library_uuid = Uuid::from_bytes(library_id);
    let asset_uuid = Uuid::from_bytes(asset_id);

    Ok(ParsedDescriptor {
        info: ContainerInfo {
            format: "BEC1",
            version: VERSION,
            suite: SUITE,
            generation,
            library_id: library_uuid.to_string(),
            asset_id: asset_uuid.to_string(),
            plaintext_size,
            chunk_size,
            chunk_count,
            encrypted_size,
            kdf,
        },
        library_id,
        asset_id,
        kdf_salt: read_array(source, offset::KDF_SALT)?,
        wrapped_master_key: read_array(source, offset::WRAPPED_MASTER_KEY)?,
        wrapped_file_key: read_array(source, offset::WRAPPED_FILE_KEY)?,
        nonce_prefix: read_array(source, offset::NONCE_PREFIX)?,
        manifest_nonce: read_array(source, offset::MANIFEST_NONCE)?,
        manifest_ciphertext: source[MANIFEST_OFFSET..manifest_end].to_vec(),
        manifest_plaintext_length,
        body: source[..DESCRIPTOR_BODY_SIZE].to_vec(),
        mac: read_array(source, DESCRIPTOR_BODY_SIZE)?,
    })
}

pub fn build_descriptor(input: &DescriptorBuildInput<'_>) -> Result<Vec<u8>> {
    validate_chunk_size(input.chunk_size)?;
    input.kdf.validate()?;
    if input.generation == 0
        || input.wrapped_master_key.len() != WRAPPED_KEY_SIZE
        || input.wrapped_file_key.len() != WRAPPED_KEY_SIZE
        || input.manifest_ciphertext.len()
            != input.manifest_plaintext_length as usize + GCM_TAG_SIZE
        || MANIFEST_OFFSET + input.manifest_ciphertext.len() > DESCRIPTOR_BODY_SIZE
    {
        return Err(Bec1Error::invalid("The descriptor input is invalid."));
    }
    let chunk_count = calculate_chunk_count(input.plaintext_size, input.chunk_size)?;
    let mut output = vec![0_u8; DESCRIPTOR_SIZE];
    output[..MAGIC.len()].copy_from_slice(MAGIC);
    write_u16(&mut output, offset::VERSION, VERSION);
    write_u16(&mut output, offset::DESCRIPTOR_SIZE, DESCRIPTOR_SIZE as u16);
    write_u32(&mut output, offset::GENERATION, input.generation);
    write_u16(&mut output, offset::SUITE, SUITE);
    write_u16(&mut output, offset::FLAGS, 0);
    write_bytes(&mut output, offset::LIBRARY_ID, &input.library_id)?;
    write_bytes(&mut output, offset::ASSET_ID, &input.asset_id)?;
    write_u64(&mut output, offset::PLAINTEXT_SIZE, input.plaintext_size);
    write_u32(&mut output, offset::CHUNK_SIZE, input.chunk_size);
    write_u32(&mut output, offset::CHUNK_COUNT, chunk_count);
    write_bytes(&mut output, offset::NONCE_PREFIX, &input.nonce_prefix)?;
    output[offset::KDF_ID] = 1;
    output[offset::KDF_VERSION] = input.kdf.version;
    write_u16(
        &mut output,
        offset::KDF_PARALLELISM,
        u16::try_from(input.kdf.parallelism)
            .map_err(|_| Bec1Error::unsafe_parameters("KDF parallelism is too large."))?,
    );
    write_u32(&mut output, offset::KDF_MEMORY_KIB, input.kdf.memory_kib);
    write_u32(&mut output, offset::KDF_PASSES, input.kdf.passes);
    write_u16(&mut output, offset::KDF_TAG_LENGTH, input.kdf.tag_length);
    write_u16(&mut output, offset::KDF_SALT_LENGTH, KDF_SALT_SIZE as u16);
    write_bytes(&mut output, offset::KDF_SALT, &input.kdf_salt)?;
    write_bytes(
        &mut output,
        offset::WRAPPED_MASTER_KEY,
        input.wrapped_master_key,
    )?;
    write_bytes(
        &mut output,
        offset::WRAPPED_FILE_KEY,
        input.wrapped_file_key,
    )?;
    write_bytes(&mut output, offset::MANIFEST_NONCE, &input.manifest_nonce)?;
    write_u32(
        &mut output,
        offset::MANIFEST_CIPHERTEXT_LENGTH,
        input.manifest_ciphertext.len() as u32,
    );
    write_u32(
        &mut output,
        offset::MANIFEST_PLAINTEXT_LENGTH,
        input.manifest_plaintext_length,
    );
    write_bytes(&mut output, MANIFEST_OFFSET, input.manifest_ciphertext)?;
    let mac = descriptor_mac(&output[..DESCRIPTOR_BODY_SIZE], input.header_auth_key)?;
    output[DESCRIPTOR_BODY_SIZE..].copy_from_slice(&mac);
    Ok(output)
}

pub fn create_chunk_nonce(nonce_prefix: &[u8; NONCE_PREFIX_SIZE], index: u32) -> [u8; 12] {
    let mut nonce = [0_u8; 12];
    nonce[..NONCE_PREFIX_SIZE].copy_from_slice(nonce_prefix);
    nonce[NONCE_PREFIX_SIZE..].copy_from_slice(&index.to_be_bytes());
    nonce
}

pub fn create_chunk_aad(
    descriptor: &ParsedDescriptor,
    index: u32,
    plaintext_length: u32,
) -> [u8; 64] {
    create_chunk_aad_from_fields(
        descriptor.library_id,
        descriptor.asset_id,
        descriptor.info.plaintext_size,
        descriptor.info.chunk_size,
        index,
        plaintext_length,
    )
}

pub fn create_chunk_aad_from_fields(
    library_id: [u8; 16],
    asset_id: [u8; 16],
    plaintext_size: u64,
    chunk_size: u32,
    index: u32,
    plaintext_length: u32,
) -> [u8; 64] {
    let mut aad = [0_u8; 64];
    aad[..8].copy_from_slice(CHUNK_AAD_MAGIC);
    aad[8..10].copy_from_slice(&VERSION.to_be_bytes());
    aad[10..12].copy_from_slice(&SUITE.to_be_bytes());
    aad[12..28].copy_from_slice(&library_id);
    aad[28..44].copy_from_slice(&asset_id);
    aad[44..52].copy_from_slice(&plaintext_size.to_be_bytes());
    aad[52..56].copy_from_slice(&chunk_size.to_be_bytes());
    aad[56..60].copy_from_slice(&index.to_be_bytes());
    aad[60..64].copy_from_slice(&plaintext_length.to_be_bytes());
    aad
}

pub fn create_manifest_aad(library_id: &[u8; 16], asset_id: &[u8; 16]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(MANIFEST_AAD_PREFIX.len() + 1 + 32);
    aad.extend_from_slice(MANIFEST_AAD_PREFIX);
    aad.push(0);
    aad.extend_from_slice(library_id);
    aad.extend_from_slice(asset_id);
    aad
}

pub fn create_file_wrap_info(asset_id: &[u8; 16]) -> Vec<u8> {
    let mut info = Vec::with_capacity(crate::constants::FILE_WRAP_INFO.len() + 1 + 16);
    info.extend_from_slice(crate::constants::FILE_WRAP_INFO);
    info.push(0);
    info.extend_from_slice(asset_id);
    info
}

pub fn create_asset_salt(library_id: &[u8; 16], asset_id: &[u8; 16]) -> [u8; 32] {
    let mut salt = [0_u8; 32];
    salt[..16].copy_from_slice(library_id);
    salt[16..].copy_from_slice(asset_id);
    salt
}

fn validate_chunk_size(chunk_size: u32) -> Result<()> {
    if !(MIN_CHUNK_SIZE..=MAX_CHUNK_SIZE).contains(&chunk_size) || !chunk_size.is_power_of_two() {
        return Err(Bec1Error::unsafe_parameters(
            "The container declares an unsafe chunk size.",
        ));
    }
    Ok(())
}

fn read_u16(source: &[u8], offset: usize) -> Result<u16> {
    Ok(u16::from_be_bytes(read_array(source, offset)?))
}

fn read_u32(source: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(read_array(source, offset)?))
}

fn read_u64(source: &[u8], offset: usize) -> Result<u64> {
    Ok(u64::from_be_bytes(read_array(source, offset)?))
}

fn read_array<const LENGTH: usize>(source: &[u8], offset: usize) -> Result<[u8; LENGTH]> {
    source
        .get(offset..offset + LENGTH)
        .ok_or_else(|| Bec1Error::invalid("The descriptor is truncated."))?
        .try_into()
        .map_err(|_| Bec1Error::invalid("The descriptor field length is invalid."))
}

fn write_u16(target: &mut [u8], offset: usize, value: u16) {
    target[offset..offset + 2].copy_from_slice(&value.to_be_bytes());
}

fn write_u32(target: &mut [u8], offset: usize, value: u32) {
    target[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
}

fn write_u64(target: &mut [u8], offset: usize, value: u64) {
    target[offset..offset + 8].copy_from_slice(&value.to_be_bytes());
}

fn write_bytes(target: &mut [u8], offset: usize, value: &[u8]) -> Result<()> {
    let destination = target
        .get_mut(offset..offset + value.len())
        .ok_or_else(|| Bec1Error::invalid("The descriptor field does not fit."))?;
    destination.copy_from_slice(value);
    Ok(())
}
