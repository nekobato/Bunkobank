# Bunkobank Encrypted Container Version 1

## Status

This document defines the normative byte format for Bunkobank Encrypted Container version 1 (`BEC1`).

The implementation is pre-release. The format must not be declared stable for third-party archives until the interoperability vectors pass in at least two independent implementations and the construction receives an external security review.

The checked-in vector passes the TypeScript reference implementation and the standalone Rust implementation in `tools/bec1-interop-rust`. Run `pnpm verify:bec1-interop` to reproduce the bidirectional and mutation checks. This satisfies the two-implementation interoperability prerequisite; the format remains pre-release pending external security review.

## Goals

`BEC1` provides the following properties for one immutable media asset:

- the asset can be recovered with its password and `.bbec` file without a Bunkobank database;
- plaintext byte ranges can be read by decrypting only the intersecting chunks;
- each chunk, descriptor, and recovery manifest is authenticated;
- a damaged primary descriptor can be recovered from a mirror descriptor;
- changing a password does not require re-encrypting media payload chunks.

`BEC1` does not encrypt the Bunkobank database, hide ciphertext sizes, provide rollback detection without external state, or protect plaintext after the vault has been unlocked.

## Primitive suite 1

| Purpose                         | Primitive                                   |
| ------------------------------- | ------------------------------------------- |
| Password normalization          | Unicode NFC, then UTF-8                     |
| Password KDF                    | Argon2id version 1.3                        |
| Default KDF parameters          | `m=65536 KiB`, `t=3`, `p=4`, 32-byte output |
| Key wrapping                    | AES-256-KW as defined by RFC 3394           |
| Subkey derivation               | HKDF-SHA-256 as defined by RFC 5869         |
| Payload and manifest encryption | AES-256-GCM with a 16-byte tag              |
| Descriptor authentication       | HMAC-SHA-256                                |
| Recovery digest                 | SHA-256                                     |

All salts, keys, and nonces created in normal operation must come from a cryptographically secure random number generator. Values fixed in an interoperability vector must never be reused in production.

## Numeric and text encoding

- Descriptor integers use unsigned big-endian encoding.
- UUIDs use the 16 raw bytes represented by their canonical textual UUID.
- Descriptor offsets are zero-based.
- Password strings are normalized to NFC before UTF-8 encoding.
- The recovery manifest uses deterministic, definite-length CBOR following RFC 8949.

## Container layout

```text
Primary descriptor (4096 bytes)
Encrypted chunk 0 (plaintext length + 16-byte tag)
Encrypted chunk 1
...
Encrypted chunk N
Mirror descriptor (4096 bytes)
```

For plaintext size `P`, chunk size `C`, and chunk count `N`:

```text
N = P == 0 ? 0 : ceil(P / C)
encrypted size = 8192 + P + N * 16
```

All chunks except the final chunk contain exactly `C` plaintext bytes. The primary and mirror descriptors are identical when first created. A reader must authenticate available descriptor candidates and select the valid candidate with the highest generation.

## Descriptor layout

|    Offset |     Size | Field                                       |
| --------: | -------: | ------------------------------------------- |
|         0 |        8 | ASCII magic `BKBEC001`                      |
|         8 |        2 | format version, `1`                         |
|        10 |        2 | descriptor size, `4096`                     |
|        12 |        4 | generation, initially `1`                   |
|        16 |        2 | cryptographic suite, `1`                    |
|        18 |        2 | flags, `0`                                  |
|        20 |       16 | library UUID                                |
|        36 |       16 | asset UUID                                  |
|        52 |        8 | plaintext size                              |
|        60 |        4 | plaintext chunk size                        |
|        64 |        4 | chunk count                                 |
|        68 |        8 | per-file chunk nonce prefix                 |
|        76 |        1 | password KDF identifier, `1` for Argon2id   |
|        77 |        1 | Argon2 version, `0x13`                      |
|        78 |        2 | Argon2 parallelism                          |
|        80 |        4 | Argon2 memory in KiB                        |
|        84 |        4 | Argon2 passes                               |
|        88 |        2 | KDF output size, `32`                       |
|        90 |        2 | KDF salt size, `16`                         |
|        92 |       16 | KDF salt                                    |
|       108 |       40 | AES-KW wrapped Library Master Key           |
|       148 |       40 | AES-KW wrapped File Data Encryption Key     |
|       188 |       12 | recovery manifest nonce                     |
|       200 |        4 | encrypted manifest length including GCM tag |
|       204 |        4 | plaintext manifest length                   |
|       208 |       16 | reserved, all zero                          |
|       224 | variable | encrypted recovery manifest and GCM tag     |
| following | variable | reserved, all zero through offset 4063      |
|      4064 |       32 | HMAC-SHA-256 of bytes 0 through 4063        |

The encrypted manifest must fit completely before offset 4064. Its maximum ciphertext length is 3840 bytes, including its 16-byte GCM tag.

Readers must reject unsupported flags, non-zero reserved bytes, non-power-of-two chunk sizes, and unsafe KDF or allocation parameters before invoking the KDF or allocating from untrusted lengths. Version 1 accepts chunk sizes from 64 KiB through 64 MiB. Argon2id parameters must use at least 65536 KiB of memory and three passes; this reader bounds untrusted descriptors to 1 GiB, ten passes, and parallelism from one through sixteen.

## Key hierarchy

`password` is normalized and processed by the descriptor's Argon2id parameters and 16-byte salt. The 32-byte result is the Recovery Key Encryption Key (`Recovery KEK`).

```text
Library Master Key = AES-256-KW-Unwrap(Recovery KEK, wrapped master key)
```

Subkeys use the following exact HKDF inputs:

```text
HeaderAuthKey = HKDF-SHA-256(
  IKM  = LibraryMasterKey,
  salt = library UUID bytes,
  info = ASCII("bunkobank/bec1/header-auth/v1"),
  L    = 32
)

FileWrappingKey = HKDF-SHA-256(
  IKM  = LibraryMasterKey,
  salt = library UUID bytes,
  info = ASCII("bunkobank/bec1/file-wrap/v1") || 0x00 || asset UUID bytes,
  L    = 32
)

FileDEK = AES-256-KW-Unwrap(FileWrappingKey, wrapped file key)

ContentKey = HKDF-SHA-256(
  IKM  = FileDEK,
  salt = library UUID bytes || asset UUID bytes,
  info = ASCII("bunkobank/bec1/content/v1"),
  L    = 32
)

ManifestKey = HKDF-SHA-256(
  IKM  = FileDEK,
  salt = library UUID bytes || asset UUID bytes,
  info = ASCII("bunkobank/bec1/manifest/v1"),
  L    = 32
)
```

The descriptor HMAC uses `HeaderAuthKey`. An implementation must authenticate the descriptor before trusting the decrypted manifest or returning plaintext chunks.

## Recovery manifest

The manifest is encrypted with AES-256-GCM using `ManifestKey`, the 12-byte nonce stored in the descriptor, and this additional authenticated data:

```text
ASCII("BEC1MANIFEST") || 0x00 || library UUID bytes || asset UUID bytes
```

The deterministic CBOR map uses ascending unsigned integer keys:

```cddl
bec1-recovery-manifest = {
  0: 1,          ; manifest version
  1: tstr,       ; original filename
  ? 2: tstr,     ; MIME type
  ? 3: tstr,     ; media kind
  ? 4: tstr,     ; item UUID
  ? 5: tstr,     ; asset role
  ? 6: uint,     ; sequence
  ? 7: tstr,     ; logical path
  ? 8: uint,     ; original modification time in Unix milliseconds
  9: bstr .size 32, ; SHA-256 of the complete plaintext
  * uint => (uint / tstr / bstr)
}
```

The manifest is deliberately sufficient for file-level recovery, not for complete reconstruction of application state. Titles, creators, series, tags, progress, and permissions belong in the database and its encrypted backup.

## Chunk encryption and random access

For zero-based chunk index `i`, the 12-byte AES-GCM nonce is:

```text
8-byte nonce prefix || uint32be(i)
```

The 64-byte additional authenticated data is:

| Offset | Size | Value                          |
| -----: | ---: | ------------------------------ |
|      0 |    8 | ASCII `BEC1CHNK`               |
|      8 |    2 | format version                 |
|     10 |    2 | cryptographic suite            |
|     12 |   16 | library UUID                   |
|     28 |   16 | asset UUID                     |
|     44 |    8 | total plaintext size           |
|     52 |    4 | chunk size                     |
|     56 |    4 | chunk index                    |
|     60 |    4 | plaintext length of this chunk |

The ciphertext record is `AES-GCM ciphertext || 16-byte tag`; it does not store the nonce separately. Binding the chunk index, asset identity, total size, and local length detects chunk reordering, cross-file substitution, and truncation.

For plaintext range `[start, endExclusive)`, a reader decrypts chunks:

```text
first = floor(start / chunkSize)
last  = floor((endExclusive - 1) / chunkSize)
```

No bytes from a chunk may be returned before its GCM tag has been verified.

## Password changes

A password change derives a new Recovery KEK and rewrites only the wrapped Library Master Key and authenticated descriptors. It does not change the Library Master Key, File DEK, or encrypted chunks.

The mirror descriptor must be committed and synchronized before replacing the primary descriptor. During an interrupted password change, either descriptor may remain valid. Copies retained before a password change remain decryptable with the old password.

## Recovery and compatibility

A conforming recovery tool must operate on `.bbec` files without opening a Bunkobank database. It must support public inspection of container geometry and password-authenticated recovery of the manifest and plaintext.

The reference CLI is built with the encrypted-container package:

```bash
bunkobank-recover inspect asset.bbec --json
bunkobank-recover inspect asset.bbec --password-file ./password.txt --json
bunkobank-recover decrypt asset.bbec ./recovered-file --password-file ./password.txt
```

Passwords are not accepted as command-line values because process argument lists can be observable by other users. `BUNKOBANK_RECOVERY_PASSWORD` is available for controlled automation, while `--password-file` is preferred for manual recovery.

The reference implementation never overwrites an existing output path. It creates new containers and recovered plaintext files with mode `0600` on platforms that honor POSIX file modes.

The interoperability vector is stored at [`packages/encrypted-container/test-vectors/bec1-v1.json`](../packages/encrypted-container/test-vectors/bec1-v1.json). It fixes password normalization, keys, salts, nonces, metadata, chunk boundaries, and expected SHA-256 values.

Implementations must preserve readers for every released format version. New algorithms require a new suite identifier; incompatible descriptor or layout changes require a new format version.
