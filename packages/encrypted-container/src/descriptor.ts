import {
  BEC1_DESCRIPTOR_BODY_SIZE,
  BEC1_DESCRIPTOR_MAC_SIZE,
  BEC1_DESCRIPTOR_SIZE,
  BEC1_GCM_TAG_SIZE,
  BEC1_KDF_SALT_SIZE,
  BEC1_MAGIC,
  BEC1_MANIFEST_NONCE_SIZE,
  BEC1_MANIFEST_OFFSET,
  BEC1_MAX_CHUNK_SIZE,
  BEC1_MAX_MANIFEST_CIPHERTEXT_SIZE,
  BEC1_MIN_CHUNK_SIZE,
  BEC1_NONCE_PREFIX_SIZE,
  BEC1_SUITE,
  BEC1_VERSION,
  BEC1_WRAPPED_KEY_SIZE
} from "./constants.js";
import { descriptorMac, validateKdfParameters } from "./crypto.js";
import { Bec1Error } from "./errors.js";
import type { Bec1ContainerInfo, Bec1KdfParameters } from "./types.js";
import { bytesToUuid, uuidToBytes } from "./uuid.js";

const OFFSETS = Object.freeze({
  version: 8,
  descriptorSize: 10,
  generation: 12,
  suite: 16,
  flags: 18,
  libraryId: 20,
  assetId: 36,
  plaintextSize: 52,
  chunkSize: 60,
  chunkCount: 64,
  noncePrefix: 68,
  kdfId: 76,
  kdfVersion: 77,
  kdfParallelism: 78,
  kdfMemoryKiB: 80,
  kdfPasses: 84,
  kdfTagLength: 88,
  kdfSaltLength: 90,
  kdfSalt: 92,
  wrappedMasterKey: 108,
  wrappedFileKey: 148,
  manifestNonce: 188,
  manifestCiphertextLength: 200,
  manifestPlaintextLength: 204,
  reserved: 208
});

export interface Bec1DescriptorFields {
  info: Bec1ContainerInfo;
  kdfSalt: Buffer;
  wrappedMasterKey: Buffer;
  wrappedFileKey: Buffer;
  noncePrefix: Buffer;
  manifestNonce: Buffer;
  manifestCiphertext: Buffer;
  manifestPlaintextLength: number;
  body: Buffer;
  mac: Buffer;
  encoded: Buffer;
}

export interface BuildBec1DescriptorInput {
  generation: number;
  libraryId: string;
  assetId: string;
  plaintextSize: number;
  chunkSize: number;
  noncePrefix: Uint8Array;
  kdf: Bec1KdfParameters;
  kdfSalt: Uint8Array;
  wrappedMasterKey: Uint8Array;
  wrappedFileKey: Uint8Array;
  manifestNonce: Uint8Array;
  manifestPlaintextLength: number;
  manifestCiphertext: Uint8Array;
  descriptorMacKey: Uint8Array;
}

const isPowerOfTwo = (value: number): boolean =>
  value > 0 && (value & (value - 1)) === 0;

export const calculateChunkCount = (
  plaintextSize: number,
  chunkSize: number
): number => (plaintextSize === 0 ? 0 : Math.ceil(plaintextSize / chunkSize));

export const calculateEncryptedSize = (
  plaintextSize: number,
  chunkCount: number
): number => {
  const result =
    BEC1_DESCRIPTOR_SIZE * 2 + plaintextSize + chunkCount * BEC1_GCM_TAG_SIZE;
  if (!Number.isSafeInteger(result)) {
    throw new Bec1Error(
      "UNSAFE_PARAMETERS",
      "The container would exceed the supported safe integer range."
    );
  }
  return result;
};

export const validateChunkGeometry = (
  plaintextSize: number,
  chunkSize: number,
  chunkCount: number
): void => {
  if (
    !Number.isSafeInteger(plaintextSize) ||
    plaintextSize < 0 ||
    !Number.isInteger(chunkSize) ||
    chunkSize < BEC1_MIN_CHUNK_SIZE ||
    chunkSize > BEC1_MAX_CHUNK_SIZE ||
    !isPowerOfTwo(chunkSize) ||
    calculateChunkCount(plaintextSize, chunkSize) !== chunkCount ||
    chunkCount > 0xffff_ffff
  ) {
    throw new Bec1Error(
      "UNSAFE_PARAMETERS",
      "The container declares invalid chunk geometry."
    );
  }
};

const assertLength = (
  value: Uint8Array,
  expected: number,
  label: string
): void => {
  if (value.byteLength !== expected) {
    throw new Bec1Error(
      "INVALID_CONTAINER",
      `${label} must contain ${expected} bytes.`
    );
  }
};

export const buildDescriptor = (input: BuildBec1DescriptorInput): Buffer => {
  const chunkCount = calculateChunkCount(input.plaintextSize, input.chunkSize);
  validateChunkGeometry(input.plaintextSize, input.chunkSize, chunkCount);
  assertLength(input.noncePrefix, BEC1_NONCE_PREFIX_SIZE, "Nonce prefix");
  assertLength(input.kdfSalt, BEC1_KDF_SALT_SIZE, "KDF salt");
  assertLength(
    input.wrappedMasterKey,
    BEC1_WRAPPED_KEY_SIZE,
    "Wrapped master key"
  );
  assertLength(input.wrappedFileKey, BEC1_WRAPPED_KEY_SIZE, "Wrapped file key");
  assertLength(input.manifestNonce, BEC1_MANIFEST_NONCE_SIZE, "Manifest nonce");
  if (
    !Number.isInteger(input.generation) ||
    input.generation < 1 ||
    input.generation > 0xffff_ffff
  ) {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid descriptor generation.");
  }
  if (
    input.manifestCiphertext.byteLength < BEC1_GCM_TAG_SIZE ||
    input.manifestCiphertext.byteLength > BEC1_MAX_MANIFEST_CIPHERTEXT_SIZE ||
    input.manifestPlaintextLength !==
      input.manifestCiphertext.byteLength - BEC1_GCM_TAG_SIZE
  ) {
    throw new Bec1Error(
      "MANIFEST_TOO_LARGE",
      "The encrypted recovery manifest does not fit in a BEC1 descriptor."
    );
  }

  const result = Buffer.alloc(BEC1_DESCRIPTOR_SIZE);
  BEC1_MAGIC.copy(result, 0);
  result.writeUInt16BE(BEC1_VERSION, OFFSETS.version);
  result.writeUInt16BE(BEC1_DESCRIPTOR_SIZE, OFFSETS.descriptorSize);
  result.writeUInt32BE(input.generation, OFFSETS.generation);
  result.writeUInt16BE(BEC1_SUITE, OFFSETS.suite);
  result.writeUInt16BE(0, OFFSETS.flags);
  uuidToBytes(input.libraryId).copy(result, OFFSETS.libraryId);
  uuidToBytes(input.assetId).copy(result, OFFSETS.assetId);
  result.writeBigUInt64BE(BigInt(input.plaintextSize), OFFSETS.plaintextSize);
  result.writeUInt32BE(input.chunkSize, OFFSETS.chunkSize);
  result.writeUInt32BE(chunkCount, OFFSETS.chunkCount);
  Buffer.from(input.noncePrefix).copy(result, OFFSETS.noncePrefix);
  result.writeUInt8(1, OFFSETS.kdfId);
  result.writeUInt8(input.kdf.version, OFFSETS.kdfVersion);
  result.writeUInt16BE(input.kdf.parallelism, OFFSETS.kdfParallelism);
  result.writeUInt32BE(input.kdf.memoryKiB, OFFSETS.kdfMemoryKiB);
  result.writeUInt32BE(input.kdf.passes, OFFSETS.kdfPasses);
  result.writeUInt16BE(input.kdf.tagLength, OFFSETS.kdfTagLength);
  result.writeUInt16BE(BEC1_KDF_SALT_SIZE, OFFSETS.kdfSaltLength);
  Buffer.from(input.kdfSalt).copy(result, OFFSETS.kdfSalt);
  Buffer.from(input.wrappedMasterKey).copy(result, OFFSETS.wrappedMasterKey);
  Buffer.from(input.wrappedFileKey).copy(result, OFFSETS.wrappedFileKey);
  Buffer.from(input.manifestNonce).copy(result, OFFSETS.manifestNonce);
  result.writeUInt32BE(
    input.manifestCiphertext.byteLength,
    OFFSETS.manifestCiphertextLength
  );
  result.writeUInt32BE(
    input.manifestPlaintextLength,
    OFFSETS.manifestPlaintextLength
  );
  Buffer.from(input.manifestCiphertext).copy(result, BEC1_MANIFEST_OFFSET);
  descriptorMac(
    result.subarray(0, BEC1_DESCRIPTOR_BODY_SIZE),
    input.descriptorMacKey
  ).copy(result, BEC1_DESCRIPTOR_BODY_SIZE);
  return result;
};

export const parseDescriptor = (
  encoded: Uint8Array,
  actualEncryptedSize: number
): Bec1DescriptorFields => {
  if (encoded.byteLength !== BEC1_DESCRIPTOR_SIZE) {
    throw new Bec1Error("INVALID_CONTAINER", "Truncated BEC1 descriptor.");
  }
  const source = Buffer.from(encoded);
  if (!source.subarray(0, BEC1_MAGIC.byteLength).equals(BEC1_MAGIC)) {
    throw new Bec1Error("INVALID_CONTAINER", "BEC1 magic does not match.");
  }
  const version = source.readUInt16BE(OFFSETS.version);
  if (
    version !== BEC1_VERSION ||
    source.readUInt16BE(OFFSETS.descriptorSize) !== BEC1_DESCRIPTOR_SIZE ||
    source.readUInt16BE(OFFSETS.suite) !== BEC1_SUITE
  ) {
    throw new Bec1Error(
      "UNSUPPORTED_VERSION",
      "The BEC1 version or cryptographic suite is unsupported."
    );
  }
  if (
    source.readUInt16BE(OFFSETS.flags) !== 0 ||
    source.readUInt8(OFFSETS.kdfId) !== 1 ||
    source.readUInt16BE(OFFSETS.kdfSaltLength) !== BEC1_KDF_SALT_SIZE ||
    source
      .subarray(OFFSETS.reserved, BEC1_MANIFEST_OFFSET)
      .some((byte) => byte !== 0)
  ) {
    throw new Bec1Error(
      "UNSUPPORTED_VERSION",
      "The BEC1 descriptor uses unsupported flags or fields."
    );
  }

  const plaintextBigInt = source.readBigUInt64BE(OFFSETS.plaintextSize);
  if (plaintextBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Bec1Error(
      "UNSAFE_PARAMETERS",
      "The plaintext size exceeds the supported safe integer range."
    );
  }
  const plaintextSize = Number(plaintextBigInt);
  const chunkSize = source.readUInt32BE(OFFSETS.chunkSize);
  const chunkCount = source.readUInt32BE(OFFSETS.chunkCount);
  validateChunkGeometry(plaintextSize, chunkSize, chunkCount);
  const encryptedSize = calculateEncryptedSize(plaintextSize, chunkCount);
  if (encryptedSize !== actualEncryptedSize) {
    throw new Bec1Error(
      "INVALID_CONTAINER",
      "The container length does not match its authenticated geometry."
    );
  }

  const manifestCiphertextLength = source.readUInt32BE(
    OFFSETS.manifestCiphertextLength
  );
  const manifestPlaintextLength = source.readUInt32BE(
    OFFSETS.manifestPlaintextLength
  );
  if (
    manifestCiphertextLength < BEC1_GCM_TAG_SIZE ||
    manifestCiphertextLength > BEC1_MAX_MANIFEST_CIPHERTEXT_SIZE ||
    manifestPlaintextLength !== manifestCiphertextLength - BEC1_GCM_TAG_SIZE
  ) {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid manifest geometry.");
  }
  const manifestEnd = BEC1_MANIFEST_OFFSET + manifestCiphertextLength;
  if (
    source
      .subarray(manifestEnd, BEC1_DESCRIPTOR_BODY_SIZE)
      .some((byte) => byte !== 0)
  ) {
    throw new Bec1Error(
      "UNSUPPORTED_VERSION",
      "The BEC1 descriptor has non-zero reserved bytes."
    );
  }

  const generation = source.readUInt32BE(OFFSETS.generation);
  if (generation < 1) {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid descriptor generation.");
  }
  const kdf: Bec1KdfParameters = {
    algorithm: "argon2id",
    version: source.readUInt8(OFFSETS.kdfVersion) as 0x13,
    parallelism: source.readUInt16BE(OFFSETS.kdfParallelism),
    memoryKiB: source.readUInt32BE(OFFSETS.kdfMemoryKiB),
    passes: source.readUInt32BE(OFFSETS.kdfPasses),
    tagLength: source.readUInt16BE(OFFSETS.kdfTagLength) as 32
  };
  validateKdfParameters(kdf);
  const libraryId = bytesToUuid(
    source.subarray(OFFSETS.libraryId, OFFSETS.libraryId + 16)
  );
  const assetId = bytesToUuid(
    source.subarray(OFFSETS.assetId, OFFSETS.assetId + 16)
  );

  return {
    info: {
      format: "BEC1",
      version: 1,
      suite: 1,
      generation,
      libraryId,
      assetId,
      plaintextSize,
      chunkSize,
      chunkCount,
      encryptedSize,
      kdf
    },
    kdfSalt: Buffer.from(
      source.subarray(OFFSETS.kdfSalt, OFFSETS.kdfSalt + BEC1_KDF_SALT_SIZE)
    ),
    wrappedMasterKey: Buffer.from(
      source.subarray(
        OFFSETS.wrappedMasterKey,
        OFFSETS.wrappedMasterKey + BEC1_WRAPPED_KEY_SIZE
      )
    ),
    wrappedFileKey: Buffer.from(
      source.subarray(
        OFFSETS.wrappedFileKey,
        OFFSETS.wrappedFileKey + BEC1_WRAPPED_KEY_SIZE
      )
    ),
    noncePrefix: Buffer.from(
      source.subarray(
        OFFSETS.noncePrefix,
        OFFSETS.noncePrefix + BEC1_NONCE_PREFIX_SIZE
      )
    ),
    manifestNonce: Buffer.from(
      source.subarray(
        OFFSETS.manifestNonce,
        OFFSETS.manifestNonce + BEC1_MANIFEST_NONCE_SIZE
      )
    ),
    manifestCiphertext: Buffer.from(
      source.subarray(BEC1_MANIFEST_OFFSET, manifestEnd)
    ),
    manifestPlaintextLength,
    body: Buffer.from(source.subarray(0, BEC1_DESCRIPTOR_BODY_SIZE)),
    mac: Buffer.from(
      source.subarray(
        BEC1_DESCRIPTOR_BODY_SIZE,
        BEC1_DESCRIPTOR_BODY_SIZE + BEC1_DESCRIPTOR_MAC_SIZE
      )
    ),
    encoded: Buffer.from(source)
  };
};

export const createChunkNonce = (
  prefix: Uint8Array,
  chunkIndex: number
): Buffer => {
  assertLength(prefix, BEC1_NONCE_PREFIX_SIZE, "Nonce prefix");
  if (
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex > 0xffff_ffff
  ) {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid chunk index.");
  }
  const result = Buffer.alloc(12);
  Buffer.from(prefix).copy(result, 0);
  result.writeUInt32BE(chunkIndex, 8);
  return result;
};

export const createChunkAad = (
  info: Pick<
    Bec1ContainerInfo,
    "libraryId" | "assetId" | "plaintextSize" | "chunkSize"
  >,
  chunkIndex: number,
  chunkPlaintextLength: number
): Buffer => {
  const result = Buffer.alloc(64);
  Buffer.from("BEC1CHNK", "ascii").copy(result, 0);
  result.writeUInt16BE(BEC1_VERSION, 8);
  result.writeUInt16BE(BEC1_SUITE, 10);
  uuidToBytes(info.libraryId).copy(result, 12);
  uuidToBytes(info.assetId).copy(result, 28);
  result.writeBigUInt64BE(BigInt(info.plaintextSize), 44);
  result.writeUInt32BE(info.chunkSize, 52);
  result.writeUInt32BE(chunkIndex, 56);
  result.writeUInt32BE(chunkPlaintextLength, 60);
  return result;
};

export const createManifestAad = (libraryId: string, assetId: string): Buffer =>
  Buffer.concat([
    Buffer.from("BEC1MANIFEST\0", "ascii"),
    uuidToBytes(libraryId),
    uuidToBytes(assetId)
  ]);
