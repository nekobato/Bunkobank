export const BEC1_MAGIC = Buffer.from("BKBEC001", "ascii");
export const BEC1_VERSION = 1;
export const BEC1_SUITE = 1;
export const BEC1_DESCRIPTOR_SIZE = 4096;
export const BEC1_DESCRIPTOR_MAC_SIZE = 32;
export const BEC1_DESCRIPTOR_BODY_SIZE =
  BEC1_DESCRIPTOR_SIZE - BEC1_DESCRIPTOR_MAC_SIZE;
export const BEC1_MANIFEST_OFFSET = 224;
export const BEC1_MAX_MANIFEST_CIPHERTEXT_SIZE =
  BEC1_DESCRIPTOR_BODY_SIZE - BEC1_MANIFEST_OFFSET;
export const BEC1_DEFAULT_CHUNK_SIZE = 1024 * 1024;
export const BEC1_MIN_CHUNK_SIZE = 64 * 1024;
export const BEC1_MAX_CHUNK_SIZE = 64 * 1024 * 1024;
export const BEC1_GCM_TAG_SIZE = 16;
export const BEC1_KEY_SIZE = 32;
export const BEC1_WRAPPED_KEY_SIZE = 40;
export const BEC1_KDF_SALT_SIZE = 16;
export const BEC1_NONCE_PREFIX_SIZE = 8;
export const BEC1_MANIFEST_NONCE_SIZE = 12;
export const BEC1_MAX_BUFFERED_RANGE_SIZE = 64 * 1024 * 1024;
export const BEC1_MIN_KDF_MEMORY_KIB = 64 * 1024;
export const BEC1_MIN_KDF_PASSES = 3;
export const BEC1_MAX_KDF_MEMORY_KIB = 1024 * 1024;
export const BEC1_MAX_KDF_PASSES = 10;
export const BEC1_MAX_KDF_PARALLELISM = 16;

export const BEC1_DEFAULT_KDF = Object.freeze({
  algorithm: "argon2id" as const,
  version: 0x13,
  memoryKiB: 64 * 1024,
  passes: 3,
  parallelism: 4,
  tagLength: BEC1_KEY_SIZE
});
