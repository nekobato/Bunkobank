use std::{collections::BTreeSet, io::Cursor};

use ciborium::value::Value;
use serde::{Deserialize, Serialize};

use crate::error::{Bec1Error, Result};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryMetadataInput {
    pub original_name: Option<String>,
    pub mime_type: Option<String>,
    pub media_kind: Option<String>,
    pub item_id: Option<String>,
    pub asset_role: Option<String>,
    pub sequence: Option<u64>,
    pub logical_path: Option<String>,
    pub modified_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryManifest {
    pub version: u64,
    pub original_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logical_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
    pub plaintext_sha256: String,
}

fn unsigned(value: u64) -> Value {
    Value::Integer(value.into())
}

fn text(value: &str) -> Value {
    Value::Text(value.to_owned())
}

pub fn encode_recovery_manifest(
    metadata: &RecoveryMetadataInput,
    fallback_original_name: &str,
    plaintext_sha256: &[u8; 32],
) -> Result<Vec<u8>> {
    let mut entries = vec![
        (unsigned(0), unsigned(1)),
        (
            unsigned(1),
            text(
                metadata
                    .original_name
                    .as_deref()
                    .unwrap_or(fallback_original_name),
            ),
        ),
    ];
    for (key, value) in [
        (2, metadata.mime_type.as_deref()),
        (3, metadata.media_kind.as_deref()),
        (4, metadata.item_id.as_deref()),
        (5, metadata.asset_role.as_deref()),
    ] {
        if let Some(value) = value {
            entries.push((unsigned(key), text(value)));
        }
    }
    if let Some(value) = metadata.sequence {
        entries.push((unsigned(6), unsigned(value)));
    }
    if let Some(value) = metadata.logical_path.as_deref() {
        entries.push((unsigned(7), text(value)));
    }
    if let Some(value) = metadata.modified_at {
        entries.push((unsigned(8), unsigned(value)));
    }
    entries.push((unsigned(9), Value::Bytes(plaintext_sha256.to_vec())));

    let mut output = Vec::new();
    ciborium::ser::into_writer(&Value::Map(entries), &mut output)
        .map_err(|error| Bec1Error::invalid(error.to_string()))?;
    Ok(output)
}

pub fn decode_recovery_manifest(source: &[u8]) -> Result<RecoveryManifest> {
    let mut reader = Cursor::new(source);
    let value: Value = ciborium::de::from_reader(&mut reader)
        .map_err(|error| Bec1Error::invalid(error.to_string()))?;
    if reader.position() != source.len() as u64 {
        return Err(Bec1Error::invalid(
            "The recovery manifest has trailing bytes.",
        ));
    }

    let mut canonical = Vec::new();
    ciborium::ser::into_writer(&value, &mut canonical)
        .map_err(|error| Bec1Error::invalid(error.to_string()))?;
    if canonical != source {
        return Err(Bec1Error::invalid(
            "The recovery manifest is not deterministic CBOR.",
        ));
    }

    let entries = match value {
        Value::Map(entries) => entries,
        _ => return Err(Bec1Error::invalid("The recovery manifest must be a map.")),
    };
    let mut seen = BTreeSet::new();
    let mut previous_key = None;
    let mut version = None;
    let mut original_name = None;
    let mut mime_type = None;
    let mut media_kind = None;
    let mut item_id = None;
    let mut asset_role = None;
    let mut sequence = None;
    let mut logical_path = None;
    let mut modified_at = None;
    let mut plaintext_sha256 = None;

    for (raw_key, raw_value) in entries {
        let key = value_as_u64(&raw_key, "manifest key")?;
        if !seen.insert(key) {
            return Err(Bec1Error::invalid(
                "The recovery manifest contains a duplicate key.",
            ));
        }
        if previous_key.is_some_and(|previous| key <= previous) {
            return Err(Bec1Error::invalid(
                "The recovery manifest keys are not strictly ascending.",
            ));
        }
        previous_key = Some(key);

        match key {
            0 => version = Some(value_as_u64(&raw_value, "manifest version")?),
            1 => original_name = Some(value_as_text(raw_value, "original name")?),
            2 => mime_type = Some(value_as_text(raw_value, "MIME type")?),
            3 => media_kind = Some(value_as_text(raw_value, "media kind")?),
            4 => item_id = Some(value_as_text(raw_value, "item UUID")?),
            5 => asset_role = Some(value_as_text(raw_value, "asset role")?),
            6 => sequence = Some(value_as_u64(&raw_value, "sequence")?),
            7 => logical_path = Some(value_as_text(raw_value, "logical path")?),
            8 => modified_at = Some(value_as_u64(&raw_value, "modification time")?),
            9 => {
                let digest = match raw_value {
                    Value::Bytes(bytes) if bytes.len() == 32 => bytes,
                    _ => {
                        return Err(Bec1Error::invalid(
                            "The recovery digest must contain 32 bytes.",
                        ))
                    }
                };
                plaintext_sha256 = Some(hex::encode(digest));
            }
            _ => validate_extension_value(&raw_value)?,
        }
    }

    if version != Some(1) {
        return Err(Bec1Error::new(
            "UNSUPPORTED_VERSION",
            "The recovery manifest version is unsupported.",
        ));
    }

    Ok(RecoveryManifest {
        version: 1,
        original_name: original_name
            .ok_or_else(|| Bec1Error::invalid("The recovery manifest has no original name."))?,
        mime_type,
        media_kind,
        item_id,
        asset_role,
        sequence,
        logical_path,
        modified_at,
        plaintext_sha256: plaintext_sha256
            .ok_or_else(|| Bec1Error::invalid("The recovery manifest has no plaintext digest."))?,
    })
}

fn value_as_u64(value: &Value, field: &str) -> Result<u64> {
    match value {
        Value::Integer(integer) => u64::try_from(*integer)
            .map_err(|_| Bec1Error::invalid(format!("The {field} must be unsigned."))),
        _ => Err(Bec1Error::invalid(format!(
            "The {field} must be an integer."
        ))),
    }
}

fn value_as_text(value: Value, field: &str) -> Result<String> {
    match value {
        Value::Text(value) => Ok(value),
        _ => Err(Bec1Error::invalid(format!("The {field} must be text."))),
    }
}

fn validate_extension_value(value: &Value) -> Result<()> {
    match value {
        Value::Integer(integer) if u64::try_from(*integer).is_ok() => Ok(()),
        Value::Text(_) | Value::Bytes(_) => Ok(()),
        _ => Err(Bec1Error::invalid(
            "The recovery manifest extension value is unsupported.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_the_deterministic_manifest() {
        let metadata = RecoveryMetadataInput {
            original_name: Some("example.bin".to_owned()),
            mime_type: Some("application/octet-stream".to_owned()),
            sequence: Some(7),
            ..RecoveryMetadataInput::default()
        };
        let digest = [0x5a; 32];
        let encoded = encode_recovery_manifest(&metadata, "fallback.bin", &digest).unwrap();

        assert_eq!(
            decode_recovery_manifest(&encoded).unwrap(),
            RecoveryManifest {
                version: 1,
                original_name: "example.bin".to_owned(),
                mime_type: Some("application/octet-stream".to_owned()),
                media_kind: None,
                item_id: None,
                asset_role: None,
                sequence: Some(7),
                logical_path: None,
                modified_at: None,
                plaintext_sha256: hex::encode(digest),
            }
        );
    }

    #[test]
    fn rejects_non_shortest_integer_encoding() {
        let mut encoded = vec![0xa3, 0x18, 0x00, 0x01, 0x01, 0x61, b'x', 0x09, 0x58, 0x20];
        encoded.extend_from_slice(&[0_u8; 32]);

        let error = decode_recovery_manifest(&encoded).unwrap_err();
        assert_eq!(error.code, "INVALID_CONTAINER");
    }

    #[test]
    fn rejects_duplicate_manifest_keys() {
        let mut encoded = vec![
            0xa4, 0x00, 0x01, 0x01, 0x61, b'x', 0x01, 0x61, b'y', 0x09, 0x58, 0x20,
        ];
        encoded.extend_from_slice(&[0_u8; 32]);

        let error = decode_recovery_manifest(&encoded).unwrap_err();
        assert_eq!(error.code, "INVALID_CONTAINER");
    }
}
