import {
  argon2,
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  timingSafeEqual,
  webcrypto
} from "node:crypto";

import {
  BEC1_GCM_TAG_SIZE,
  BEC1_KEY_SIZE,
  BEC1_MAX_KDF_MEMORY_KIB,
  BEC1_MAX_KDF_PARALLELISM,
  BEC1_MAX_KDF_PASSES,
  BEC1_MIN_KDF_MEMORY_KIB,
  BEC1_MIN_KDF_PASSES
} from "./constants.js";
import { asAuthenticationError, Bec1Error } from "./errors.js";
import type { Bec1KdfParameters } from "./types.js";

const subtle = webcrypto.subtle;

export const validateKdfParameters = (kdf: Bec1KdfParameters): void => {
  if (
    kdf.algorithm !== "argon2id" ||
    kdf.version !== 0x13 ||
    kdf.tagLength !== BEC1_KEY_SIZE
  ) {
    throw new Bec1Error(
      "UNSUPPORTED_VERSION",
      "The container uses an unsupported password KDF."
    );
  }

  if (
    !Number.isInteger(kdf.memoryKiB) ||
    !Number.isInteger(kdf.passes) ||
    !Number.isInteger(kdf.parallelism) ||
    kdf.parallelism < 1 ||
    kdf.parallelism > BEC1_MAX_KDF_PARALLELISM ||
    kdf.passes < BEC1_MIN_KDF_PASSES ||
    kdf.passes > BEC1_MAX_KDF_PASSES ||
    kdf.memoryKiB < Math.max(8 * kdf.parallelism, BEC1_MIN_KDF_MEMORY_KIB) ||
    kdf.memoryKiB > BEC1_MAX_KDF_MEMORY_KIB
  ) {
    throw new Bec1Error(
      "UNSAFE_PARAMETERS",
      "The container declares unsafe Argon2id parameters."
    );
  }
};

export const deriveRecoveryKek = async (
  password: string,
  salt: Uint8Array,
  kdf: Bec1KdfParameters
): Promise<Buffer> => {
  validateKdfParameters(kdf);
  const normalizedPassword = password.normalize("NFC");
  for (let index = 0; index < normalizedPassword.length; index += 1) {
    const codeUnit = normalizedPassword.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = normalizedPassword.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new Bec1Error(
          "UNSAFE_PARAMETERS",
          "The password contains an unpaired Unicode surrogate."
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Bec1Error(
        "UNSAFE_PARAMETERS",
        "The password contains an unpaired Unicode surrogate."
      );
    }
  }
  const message = Buffer.from(normalizedPassword, "utf8");

  try {
    return await new Promise<Buffer>((resolve, reject) => {
      argon2(
        "argon2id",
        {
          message,
          nonce: salt,
          parallelism: kdf.parallelism,
          tagLength: kdf.tagLength,
          memory: kdf.memoryKiB,
          passes: kdf.passes
        },
        (error, derivedKey) => {
          message.fill(0);
          if (error) {
            reject(error);
            return;
          }
          resolve(Buffer.from(derivedKey));
        }
      );
    });
  } catch (error) {
    message.fill(0);
    throw error;
  }
};

export const deriveSubkey = (
  key: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array
): Buffer => Buffer.from(hkdfSync("sha256", key, salt, info, BEC1_KEY_SIZE));

export const wrapKey = async (
  wrappingKey: Uint8Array,
  rawKey: Uint8Array
): Promise<Buffer> => {
  const kek = await subtle.importKey("raw", wrappingKey, "AES-KW", false, [
    "wrapKey"
  ]);
  const key = await subtle.importKey("raw", rawKey, "AES-GCM", true, [
    "encrypt",
    "decrypt"
  ]);
  return Buffer.from(await subtle.wrapKey("raw", key, kek, "AES-KW"));
};

export const unwrapKey = async (
  wrappingKey: Uint8Array,
  wrappedKey: Uint8Array
): Promise<Buffer> => {
  try {
    const kek = await subtle.importKey("raw", wrappingKey, "AES-KW", false, [
      "unwrapKey"
    ]);
    const key = await subtle.unwrapKey(
      "raw",
      wrappedKey,
      kek,
      "AES-KW",
      "AES-GCM",
      true,
      ["encrypt", "decrypt"]
    );
    return Buffer.from(await subtle.exportKey("raw", key));
  } catch (error) {
    throw asAuthenticationError(error);
  }
};

export const encryptAesGcm = (
  plaintext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array
): Buffer => {
  const cipher = createCipheriv("aes-256-gcm", key, nonce, {
    authTagLength: BEC1_GCM_TAG_SIZE
  });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]);
};

export const decryptAesGcm = (
  ciphertextAndTag: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array
): Buffer => {
  if (ciphertextAndTag.byteLength < BEC1_GCM_TAG_SIZE) {
    throw asAuthenticationError(
      new Error("The authenticated ciphertext is truncated.")
    );
  }

  try {
    const ciphertext = Buffer.from(ciphertextAndTag).subarray(
      0,
      -BEC1_GCM_TAG_SIZE
    );
    const tag = Buffer.from(ciphertextAndTag).subarray(-BEC1_GCM_TAG_SIZE);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
      authTagLength: BEC1_GCM_TAG_SIZE
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw asAuthenticationError(error);
  }
};

export const descriptorMac = (
  descriptorBody: Uint8Array,
  key: Uint8Array
): Buffer => createHmac("sha256", key).update(descriptorBody).digest();

export const verifyDescriptorMac = (
  descriptorBody: Uint8Array,
  expected: Uint8Array,
  key: Uint8Array
): void => {
  const actual = descriptorMac(descriptorBody, key);
  if (
    actual.byteLength !== expected.byteLength ||
    !timingSafeEqual(actual, expected)
  ) {
    throw asAuthenticationError(
      new Error("The descriptor authentication code does not match.")
    );
  }
};
