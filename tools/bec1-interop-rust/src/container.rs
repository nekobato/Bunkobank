use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    constants::{CONTENT_INFO, DESCRIPTOR_SIZE, GCM_TAG_SIZE, HEADER_AUTH_INFO, MANIFEST_INFO},
    crypto::{
        decrypt_aes_gcm, derive_recovery_kek, derive_subkey, unwrap_key, verify_descriptor_mac,
    },
    error::{Bec1Error, Result},
    format::{
        create_asset_salt, create_chunk_aad, create_chunk_nonce, create_file_wrap_info,
        create_manifest_aad, parse_descriptor, ContainerInfo, ParsedDescriptor,
    },
    manifest::{decode_recovery_manifest, RecoveryManifest},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedInspectOutput {
    #[serde(flatten)]
    pub info: ContainerInfo,
    pub recovery: RecoveryManifest,
}

struct AuthenticatedContainer {
    descriptor: ParsedDescriptor,
    manifest: RecoveryManifest,
    content_key: Zeroizing<[u8; 32]>,
}

pub fn inspect_public(path: &Path) -> Result<ContainerInfo> {
    let mut candidates = read_candidates(path)?;
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.info.generation));
    candidates
        .into_iter()
        .next()
        .map(|candidate| candidate.info)
        .ok_or_else(|| Bec1Error::invalid("No structurally valid descriptor was found."))
}

pub fn inspect_authenticated(path: &Path, password: &str) -> Result<AuthenticatedInspectOutput> {
    let authenticated = authenticate_container(path, password)?;
    Ok(AuthenticatedInspectOutput {
        info: authenticated.descriptor.info,
        recovery: authenticated.manifest,
    })
}

pub fn decrypt_file(path: &Path, output_path: &Path, password: &str) -> Result<RecoveryManifest> {
    let authenticated = authenticate_container(path, password)?;
    let temporary_path = create_temporary_path(output_path)?;
    let result = decrypt_to_temporary(path, &temporary_path, &authenticated).and_then(|manifest| {
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
        Ok(manifest)
    });
    let _ = fs::remove_file(&temporary_path);
    result
}

fn authenticate_container(path: &Path, password: &str) -> Result<AuthenticatedContainer> {
    let mut candidates = read_candidates(path)?;
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.info.generation));
    for candidate in candidates {
        if let Ok(authenticated) = authenticate_descriptor(candidate, password) {
            return Ok(authenticated);
        }
    }
    Err(Bec1Error::authentication())
}

fn authenticate_descriptor(
    descriptor: ParsedDescriptor,
    password: &str,
) -> Result<AuthenticatedContainer> {
    let recovery_kek = derive_recovery_kek(password, &descriptor.kdf_salt, &descriptor.info.kdf)?;
    let master_key = unwrap_key(recovery_kek.as_ref(), &descriptor.wrapped_master_key)?;
    let header_auth_key = derive_subkey(&master_key, &descriptor.library_id, HEADER_AUTH_INFO)?;
    verify_descriptor_mac(&descriptor.body, &descriptor.mac, header_auth_key.as_ref())?;

    let file_wrap_info = create_file_wrap_info(&descriptor.asset_id);
    let file_wrapping_key = derive_subkey(&master_key, &descriptor.library_id, &file_wrap_info)?;
    let file_key = unwrap_key(file_wrapping_key.as_ref(), &descriptor.wrapped_file_key)?;
    let asset_salt = create_asset_salt(&descriptor.library_id, &descriptor.asset_id);
    let content_key = derive_subkey(&file_key, &asset_salt, CONTENT_INFO)?;
    let manifest_key = derive_subkey(&file_key, &asset_salt, MANIFEST_INFO)?;
    let manifest_aad = create_manifest_aad(&descriptor.library_id, &descriptor.asset_id);
    let manifest_plaintext = decrypt_aes_gcm(
        &descriptor.manifest_ciphertext,
        manifest_key.as_ref(),
        &descriptor.manifest_nonce,
        &manifest_aad,
    )?;
    if manifest_plaintext.len() != descriptor.manifest_plaintext_length as usize {
        return Err(Bec1Error::authentication());
    }
    let manifest = decode_recovery_manifest(&manifest_plaintext)?;

    Ok(AuthenticatedContainer {
        descriptor,
        manifest,
        content_key,
    })
}

fn read_candidates(path: &Path) -> Result<Vec<ParsedDescriptor>> {
    let mut file = File::open(path)?;
    let file_size = file.metadata()?.len();
    if file_size < (DESCRIPTOR_SIZE * 2) as u64 {
        return Err(Bec1Error::invalid("The container is too short."));
    }
    let positions = [0_u64, file_size - DESCRIPTOR_SIZE as u64];
    let mut candidates = Vec::new();
    let mut first_error = None;
    for position in positions {
        let mut source = vec![0_u8; DESCRIPTOR_SIZE];
        let parsed = file
            .seek(SeekFrom::Start(position))
            .and_then(|_| file.read_exact(&mut source))
            .map_err(Bec1Error::from)
            .and_then(|_| parse_descriptor(&source, file_size));
        match parsed {
            Ok(candidate) => candidates.push(candidate),
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    if candidates.is_empty() {
        return Err(first_error
            .unwrap_or_else(|| Bec1Error::invalid("No descriptor candidate is available.")));
    }
    Ok(candidates)
}

fn decrypt_to_temporary(
    input_path: &Path,
    temporary_path: &Path,
    authenticated: &AuthenticatedContainer,
) -> Result<RecoveryManifest> {
    let descriptor = &authenticated.descriptor;
    let mut input = File::open(input_path)?;
    let mut output = open_new_private_file(temporary_path)?;
    let mut hasher = Sha256::new();
    for index in 0..descriptor.info.chunk_count {
        let chunk_start = index as u64 * descriptor.info.chunk_size as u64;
        let remaining = descriptor.info.plaintext_size - chunk_start;
        let plaintext_length = remaining.min(descriptor.info.chunk_size as u64) as u32;
        let encrypted_length = plaintext_length as usize + GCM_TAG_SIZE;
        let encrypted_position = DESCRIPTOR_SIZE as u64
            + index as u64 * (descriptor.info.chunk_size as u64 + GCM_TAG_SIZE as u64);
        let mut ciphertext = vec![0_u8; encrypted_length];
        input.seek(SeekFrom::Start(encrypted_position))?;
        input.read_exact(&mut ciphertext)?;
        let nonce = create_chunk_nonce(&descriptor.nonce_prefix, index);
        let aad = create_chunk_aad(descriptor, index, plaintext_length);
        let plaintext_buffer = decrypt_aes_gcm(
            &ciphertext,
            authenticated.content_key.as_ref(),
            &nonce,
            &aad,
        )?;
        hasher.update(plaintext_buffer.as_slice());
        output.write_all(plaintext_buffer.as_slice())?;
        ciphertext.zeroize();
    }
    output.flush()?;
    output.sync_all()?;

    let digest = hex::encode(hasher.finalize());
    if digest != authenticated.manifest.plaintext_sha256 {
        return Err(Bec1Error::authentication());
    }
    Ok(authenticated.manifest.clone())
}

fn create_temporary_path(output_path: &Path) -> Result<PathBuf> {
    let directory = output_path.parent().unwrap_or_else(|| Path::new("."));
    for attempt in 0..1000_u32 {
        let candidate = directory.join(format!(
            ".bec1-interop-{}-{attempt}.part",
            std::process::id()
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(Bec1Error::new(
        "IO_ERROR",
        "Unable to allocate a temporary output path.",
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
