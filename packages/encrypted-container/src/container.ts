import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { decodeRecoveryManifest, encodeRecoveryManifest } from "./cbor.js";
import {
  BEC1_DEFAULT_CHUNK_SIZE,
  BEC1_DEFAULT_KDF,
  BEC1_DESCRIPTOR_SIZE,
  BEC1_GCM_TAG_SIZE,
  BEC1_KDF_SALT_SIZE,
  BEC1_KEY_SIZE,
  BEC1_MANIFEST_NONCE_SIZE,
  BEC1_MAX_BUFFERED_RANGE_SIZE,
  BEC1_NONCE_PREFIX_SIZE
} from "./constants.js";
import {
  decryptAesGcm,
  deriveRecoveryKek,
  deriveSubkey,
  encryptAesGcm,
  unwrapKey,
  validateKdfParameters,
  verifyDescriptorMac,
  wrapKey
} from "./crypto.js";
import {
  buildDescriptor,
  calculateChunkCount,
  calculateEncryptedSize,
  createChunkAad,
  createChunkNonce,
  createManifestAad,
  parseDescriptor,
  validateChunkGeometry,
  type Bec1DescriptorFields
} from "./descriptor.js";
import { asAuthenticationError, Bec1Error } from "./errors.js";
import { readExact, withAtomicOutput, writeAll } from "./file-io.js";
import type {
  Bec1ByteRange,
  Bec1ContainerInfo,
  Bec1KdfParameters,
  Bec1LibraryEncryptor,
  Bec1OpenContainer,
  Bec1RecoveryManifest,
  CreateBec1LibraryEncryptorOptions,
  DecryptBec1FileOptions,
  EncryptBec1FileOptions,
  RewrapBec1FilePasswordOptions
} from "./types.js";
import { uuidToBytes } from "./uuid.js";

const INFO_HEADER_AUTH = Buffer.from("bunkobank/bec1/header-auth/v1", "ascii");
const INFO_FILE_WRAP = Buffer.from("bunkobank/bec1/file-wrap/v1\0", "ascii");
const INFO_CONTENT = Buffer.from("bunkobank/bec1/content/v1", "ascii");
const INFO_MANIFEST = Buffer.from("bunkobank/bec1/manifest/v1", "ascii");

interface Bec1LibrarySecrets {
  libraryId: string;
  masterKey: Buffer;
  kdf: Bec1KdfParameters;
  kdfSalt: Buffer;
  wrappedMasterKey: Buffer;
}

/** Internal deterministic materials used to produce cross-language vectors. */
export interface Bec1FileMaterials {
  assetId: string;
  fileKey: Buffer;
  noncePrefix: Buffer;
  manifestNonce: Buffer;
}

interface AuthenticatedDescriptor {
  descriptor: Bec1DescriptorFields;
  masterKey: Buffer;
  fileKey: Buffer;
  contentKey: Buffer;
  manifest: Bec1RecoveryManifest;
}

const deriveHeaderAuthKey = (
  masterKey: Uint8Array,
  libraryId: string
): Buffer => deriveSubkey(masterKey, uuidToBytes(libraryId), INFO_HEADER_AUTH);

const deriveFileWrappingKey = (
  masterKey: Uint8Array,
  libraryId: string,
  assetId: string
): Buffer =>
  deriveSubkey(
    masterKey,
    uuidToBytes(libraryId),
    Buffer.concat([INFO_FILE_WRAP, uuidToBytes(assetId)])
  );

const deriveFileSubkey = (
  fileKey: Uint8Array,
  libraryId: string,
  assetId: string,
  info: Uint8Array
): Buffer =>
  deriveSubkey(
    fileKey,
    Buffer.concat([uuidToBytes(libraryId), uuidToBytes(assetId)]),
    info
  );

const resolveKdf = (
  overrides: CreateBec1LibraryEncryptorOptions["kdf"] = {}
): Bec1KdfParameters => ({
  ...BEC1_DEFAULT_KDF,
  ...overrides
});

const openRegularFileStat = async (path: string) => {
  const value = await stat(path);
  if (!value.isFile() || !Number.isSafeInteger(value.size)) {
    throw new Bec1Error(
      "UNSAFE_PARAMETERS",
      `BEC1 only supports regular files with safe integer sizes: ${path}`
    );
  }
  return value;
};

const expectedPlaintextChunkLength = (
  info: Bec1ContainerInfo,
  chunkIndex: number
): number =>
  Math.min(info.chunkSize, info.plaintextSize - chunkIndex * info.chunkSize);

const chunkCiphertextOffset = (
  info: Bec1ContainerInfo,
  chunkIndex: number
): number =>
  BEC1_DESCRIPTOR_SIZE + chunkIndex * (info.chunkSize + BEC1_GCM_TAG_SIZE);

const readDescriptorCandidates = async (
  handle: Awaited<ReturnType<typeof open>>,
  encryptedSize: number
): Promise<Bec1DescriptorFields[]> => {
  if (encryptedSize < BEC1_DESCRIPTOR_SIZE * 2) {
    throw new Bec1Error(
      "INVALID_CONTAINER",
      "The BEC1 container is truncated."
    );
  }
  const encodedDescriptors = await Promise.all([
    readExact(handle, BEC1_DESCRIPTOR_SIZE, 0),
    readExact(
      handle,
      BEC1_DESCRIPTOR_SIZE,
      encryptedSize - BEC1_DESCRIPTOR_SIZE
    )
  ]);

  const candidates: Bec1DescriptorFields[] = [];
  for (const encoded of encodedDescriptors) {
    if (candidates.some((candidate) => candidate.encoded.equals(encoded))) {
      continue;
    }
    try {
      candidates.push(parseDescriptor(encoded, encryptedSize));
    } catch {
      // A valid mirrored descriptor is sufficient for recovery.
    }
  }
  if (candidates.length === 0) {
    throw new Bec1Error(
      "INVALID_CONTAINER",
      "Neither BEC1 descriptor is structurally valid."
    );
  }
  return candidates.sort(
    (left, right) => right.info.generation - left.info.generation
  );
};

const authenticateDescriptor = async (
  descriptor: Bec1DescriptorFields,
  password: string
): Promise<AuthenticatedDescriptor> => {
  validateKdfParameters(descriptor.info.kdf);
  const recoveryKek = await deriveRecoveryKek(
    password,
    descriptor.kdfSalt,
    descriptor.info.kdf
  );
  let masterKey: Buffer | undefined;
  let fileKey: Buffer | undefined;
  let contentKey: Buffer | undefined;

  try {
    masterKey = await unwrapKey(recoveryKek, descriptor.wrappedMasterKey);
    const headerAuthKey = deriveHeaderAuthKey(
      masterKey,
      descriptor.info.libraryId
    );
    try {
      verifyDescriptorMac(descriptor.body, descriptor.mac, headerAuthKey);
    } finally {
      headerAuthKey.fill(0);
    }

    const fileWrappingKey = deriveFileWrappingKey(
      masterKey,
      descriptor.info.libraryId,
      descriptor.info.assetId
    );
    try {
      fileKey = await unwrapKey(fileWrappingKey, descriptor.wrappedFileKey);
    } finally {
      fileWrappingKey.fill(0);
    }
    contentKey = deriveFileSubkey(
      fileKey,
      descriptor.info.libraryId,
      descriptor.info.assetId,
      INFO_CONTENT
    );
    const manifestKey = deriveFileSubkey(
      fileKey,
      descriptor.info.libraryId,
      descriptor.info.assetId,
      INFO_MANIFEST
    );
    let manifestPlaintext: Buffer;
    try {
      manifestPlaintext = decryptAesGcm(
        descriptor.manifestCiphertext,
        manifestKey,
        descriptor.manifestNonce,
        createManifestAad(descriptor.info.libraryId, descriptor.info.assetId)
      );
    } finally {
      manifestKey.fill(0);
    }
    if (manifestPlaintext.byteLength !== descriptor.manifestPlaintextLength) {
      manifestPlaintext.fill(0);
      throw asAuthenticationError(new Error("Manifest length mismatch."));
    }
    try {
      const manifest = decodeRecoveryManifest(manifestPlaintext);
      return { descriptor, masterKey, fileKey, contentKey, manifest };
    } finally {
      manifestPlaintext.fill(0);
    }
  } catch (error) {
    masterKey?.fill(0);
    fileKey?.fill(0);
    contentKey?.fill(0);
    throw asAuthenticationError(error);
  } finally {
    recoveryKek.fill(0);
  }
};

const authenticateAnyDescriptor = async (
  candidates: Bec1DescriptorFields[],
  password: string
): Promise<AuthenticatedDescriptor> => {
  let failure: unknown;
  for (const candidate of candidates) {
    try {
      return await authenticateDescriptor(candidate, password);
    } catch (error) {
      failure = error;
    }
  }
  throw asAuthenticationError(failure);
};

const validateRange = (range: Bec1ByteRange, plaintextSize: number): void => {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.endExclusive) ||
    range.start < 0 ||
    range.endExclusive < range.start ||
    range.endExclusive > plaintextSize
  ) {
    throw new Bec1Error("INVALID_RANGE", "Invalid BEC1 plaintext byte range.");
  }
};

export const encryptBec1FileWithSecrets = async (
  secrets: Bec1LibrarySecrets,
  options: EncryptBec1FileOptions,
  materials?: Bec1FileMaterials
): Promise<Bec1ContainerInfo> => {
  const activeMaterials: Bec1FileMaterials = {
    assetId: materials?.assetId ?? options.assetId ?? randomUUID(),
    fileKey: materials
      ? Buffer.from(materials.fileKey)
      : randomBytes(BEC1_KEY_SIZE),
    noncePrefix: materials
      ? Buffer.from(materials.noncePrefix)
      : randomBytes(BEC1_NONCE_PREFIX_SIZE),
    manifestNonce: materials
      ? Buffer.from(materials.manifestNonce)
      : randomBytes(BEC1_MANIFEST_NONCE_SIZE)
  };
  try {
    const inputPath = resolve(options.inputPath);
    const outputPath = resolve(options.outputPath);
    if (inputPath === outputPath) {
      throw new Bec1Error(
        "UNSAFE_PARAMETERS",
        "Input and encrypted output paths must be different."
      );
    }
    const initialStat = await openRegularFileStat(inputPath);
    const chunkSize = options.chunkSize ?? BEC1_DEFAULT_CHUNK_SIZE;
    const chunkCount = calculateChunkCount(initialStat.size, chunkSize);
    validateChunkGeometry(initialStat.size, chunkSize, chunkCount);
    const encryptedSize = calculateEncryptedSize(initialStat.size, chunkCount);
    const info: Bec1ContainerInfo = {
      format: "BEC1",
      version: 1,
      suite: 1,
      generation: 1,
      libraryId: secrets.libraryId,
      assetId: activeMaterials.assetId,
      plaintextSize: initialStat.size,
      chunkSize,
      chunkCount,
      encryptedSize,
      kdf: secrets.kdf
    };

    return await withAtomicOutput(outputPath, async (temporaryPath) => {
      const source = await open(inputPath, "r");
      const destination = await open(temporaryPath, "wx", 0o600);
      const contentKey = deriveFileSubkey(
        activeMaterials.fileKey,
        secrets.libraryId,
        activeMaterials.assetId,
        INFO_CONTENT
      );
      const digest = createHash("sha256");

      try {
        const openedStat = await source.stat();
        if (
          !openedStat.isFile() ||
          openedStat.size !== initialStat.size ||
          openedStat.mtimeMs !== initialStat.mtimeMs ||
          openedStat.dev !== initialStat.dev ||
          openedStat.ino !== initialStat.ino
        ) {
          throw new Bec1Error(
            "SOURCE_CHANGED",
            "The source file changed before encryption started."
          );
        }
        await writeAll(destination, Buffer.alloc(BEC1_DESCRIPTOR_SIZE), 0);
        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
          const plaintextLength = expectedPlaintextChunkLength(
            info,
            chunkIndex
          );
          const plaintext = await readExact(
            source,
            plaintextLength,
            chunkIndex * chunkSize
          );
          digest.update(plaintext);
          let ciphertext: Buffer;
          try {
            ciphertext = encryptAesGcm(
              plaintext,
              contentKey,
              createChunkNonce(activeMaterials.noncePrefix, chunkIndex),
              createChunkAad(info, chunkIndex, plaintextLength)
            );
          } finally {
            plaintext.fill(0);
          }
          await writeAll(
            destination,
            ciphertext,
            chunkCiphertextOffset(info, chunkIndex)
          );
        }

        const finalStat = await source.stat();
        if (
          finalStat.size !== initialStat.size ||
          finalStat.mtimeMs !== initialStat.mtimeMs
        ) {
          throw new Bec1Error(
            "SOURCE_CHANGED",
            "The source file changed while it was being encrypted."
          );
        }

        const manifestPlaintext = encodeRecoveryManifest(
          options.recovery ?? {},
          options.recovery?.originalName ?? basename(inputPath),
          digest.digest()
        );
        const manifestKey = deriveFileSubkey(
          activeMaterials.fileKey,
          secrets.libraryId,
          activeMaterials.assetId,
          INFO_MANIFEST
        );
        let manifestCiphertext: Buffer;
        try {
          manifestCiphertext = encryptAesGcm(
            manifestPlaintext,
            manifestKey,
            activeMaterials.manifestNonce,
            createManifestAad(secrets.libraryId, activeMaterials.assetId)
          );
        } finally {
          manifestKey.fill(0);
          manifestPlaintext.fill(0);
        }

        const fileWrappingKey = deriveFileWrappingKey(
          secrets.masterKey,
          secrets.libraryId,
          activeMaterials.assetId
        );
        let wrappedFileKey: Buffer;
        try {
          wrappedFileKey = await wrapKey(
            fileWrappingKey,
            activeMaterials.fileKey
          );
        } finally {
          fileWrappingKey.fill(0);
        }
        const headerAuthKey = deriveHeaderAuthKey(
          secrets.masterKey,
          secrets.libraryId
        );
        let descriptor: Buffer;
        try {
          descriptor = buildDescriptor({
            generation: 1,
            libraryId: secrets.libraryId,
            assetId: activeMaterials.assetId,
            plaintextSize: initialStat.size,
            chunkSize,
            noncePrefix: activeMaterials.noncePrefix,
            kdf: secrets.kdf,
            kdfSalt: secrets.kdfSalt,
            wrappedMasterKey: secrets.wrappedMasterKey,
            wrappedFileKey,
            manifestNonce: activeMaterials.manifestNonce,
            manifestPlaintextLength:
              manifestCiphertext.byteLength - BEC1_GCM_TAG_SIZE,
            manifestCiphertext,
            descriptorMacKey: headerAuthKey
          });
        } finally {
          headerAuthKey.fill(0);
        }
        await writeAll(
          destination,
          descriptor,
          encryptedSize - BEC1_DESCRIPTOR_SIZE
        );
        await writeAll(destination, descriptor, 0);
        await destination.sync();
        return info;
      } finally {
        contentKey.fill(0);
        await Promise.all([source.close(), destination.close()]);
      }
    });
  } finally {
    activeMaterials.fileKey.fill(0);
    activeMaterials.noncePrefix.fill(0);
    activeMaterials.manifestNonce.fill(0);
  }
};

const createEncryptorFromSecrets = (
  secrets: Bec1LibrarySecrets
): Bec1LibraryEncryptor => {
  let disposed = false;

  return {
    libraryId: secrets.libraryId,
    encryptFile: async (fileOptions) => {
      if (disposed) {
        throw new Bec1Error("CLOSED", "The BEC1 library key is disposed.");
      }
      const operationSecrets: Bec1LibrarySecrets = {
        libraryId: secrets.libraryId,
        masterKey: Buffer.from(secrets.masterKey),
        kdf: { ...secrets.kdf },
        kdfSalt: Buffer.from(secrets.kdfSalt),
        wrappedMasterKey: Buffer.from(secrets.wrappedMasterKey)
      };
      try {
        return await encryptBec1FileWithSecrets(operationSecrets, fileOptions);
      } finally {
        operationSecrets.masterKey.fill(0);
        operationSecrets.kdfSalt.fill(0);
        operationSecrets.wrappedMasterKey.fill(0);
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      secrets.masterKey.fill(0);
      secrets.kdfSalt.fill(0);
      secrets.wrappedMasterKey.fill(0);
    }
  };
};

/** Creates an in-memory library key context. Dispose it when the vault locks. */
export const createBec1LibraryEncryptor = async (
  options: CreateBec1LibraryEncryptorOptions
): Promise<Bec1LibraryEncryptor> => {
  const kdf = resolveKdf(options.kdf);
  validateKdfParameters(kdf);
  const secrets: Bec1LibrarySecrets = {
    libraryId: options.libraryId ?? randomUUID(),
    masterKey: randomBytes(BEC1_KEY_SIZE),
    kdf,
    kdfSalt: randomBytes(BEC1_KDF_SALT_SIZE),
    wrappedMasterKey: Buffer.alloc(0)
  };
  let recoveryKek: Buffer | undefined;
  try {
    recoveryKek = await deriveRecoveryKek(
      options.password,
      secrets.kdfSalt,
      kdf
    );
    secrets.wrappedMasterKey = await wrapKey(recoveryKek, secrets.masterKey);
    return createEncryptorFromSecrets(secrets);
  } catch (error) {
    secrets.masterKey.fill(0);
    secrets.kdfSalt.fill(0);
    secrets.wrappedMasterKey.fill(0);
    throw error;
  } finally {
    recoveryKek?.fill(0);
  }
};

/** Unlocks a library key from any of its self-contained BEC1 assets. */
export const openBec1LibraryEncryptor = async (
  inputPath: string,
  password: string
): Promise<Bec1LibraryEncryptor> => {
  const sourceStat = await openRegularFileStat(inputPath);
  const handle = await open(inputPath, "r");
  try {
    const authenticated = await authenticateAnyDescriptor(
      await readDescriptorCandidates(handle, sourceStat.size),
      password
    );
    authenticated.fileKey.fill(0);
    authenticated.contentKey.fill(0);
    return createEncryptorFromSecrets({
      libraryId: authenticated.descriptor.info.libraryId,
      masterKey: authenticated.masterKey,
      kdf: { ...authenticated.descriptor.info.kdf },
      kdfSalt: Buffer.from(authenticated.descriptor.kdfSalt),
      wrappedMasterKey: Buffer.from(authenticated.descriptor.wrappedMasterKey)
    });
  } finally {
    await handle.close();
  }
};

/** Rewraps one self-contained asset with a new password without reading chunks. */
export const rewrapBec1FilePassword = async (
  options: RewrapBec1FilePasswordOptions
): Promise<Bec1ContainerInfo> => {
  const inputPath = resolve(options.inputPath);
  const sourceStat = await openRegularFileStat(inputPath);
  const handle = await open(inputPath, "r+");
  let authenticated: AuthenticatedDescriptor | undefined;
  let recoveryKek: Buffer | undefined;
  let newWrappedMasterKey: Buffer | undefined;
  let newKdfSalt: Buffer | undefined;

  try {
    authenticated = await authenticateAnyDescriptor(
      await readDescriptorCandidates(handle, sourceStat.size),
      options.oldPassword
    );
    const current = authenticated.descriptor;
    if (current.info.generation === 0xffff_ffff) {
      throw new Bec1Error(
        "UNSAFE_PARAMETERS",
        "The descriptor generation cannot be incremented."
      );
    }
    const newKdf = resolveKdf(options.kdf);
    validateKdfParameters(newKdf);
    newKdfSalt = randomBytes(BEC1_KDF_SALT_SIZE);
    recoveryKek = await deriveRecoveryKek(
      options.newPassword,
      newKdfSalt,
      newKdf
    );
    newWrappedMasterKey = await wrapKey(recoveryKek, authenticated.masterKey);
    const headerAuthKey = deriveHeaderAuthKey(
      authenticated.masterKey,
      current.info.libraryId
    );
    let replacement: Buffer;
    try {
      replacement = buildDescriptor({
        generation: current.info.generation + 1,
        libraryId: current.info.libraryId,
        assetId: current.info.assetId,
        plaintextSize: current.info.plaintextSize,
        chunkSize: current.info.chunkSize,
        noncePrefix: current.noncePrefix,
        kdf: newKdf,
        kdfSalt: newKdfSalt,
        wrappedMasterKey: newWrappedMasterKey,
        wrappedFileKey: current.wrappedFileKey,
        manifestNonce: current.manifestNonce,
        manifestPlaintextLength: current.manifestPlaintextLength,
        manifestCiphertext: current.manifestCiphertext,
        descriptorMacKey: headerAuthKey
      });
    } finally {
      headerAuthKey.fill(0);
    }

    await writeAll(handle, replacement, sourceStat.size - BEC1_DESCRIPTOR_SIZE);
    await handle.sync();
    await writeAll(handle, replacement, 0);
    await handle.sync();

    return {
      ...current.info,
      generation: current.info.generation + 1,
      kdf: newKdf
    };
  } finally {
    authenticated?.masterKey.fill(0);
    authenticated?.fileKey.fill(0);
    authenticated?.contentKey.fill(0);
    recoveryKek?.fill(0);
    newWrappedMasterKey?.fill(0);
    newKdfSalt?.fill(0);
    await handle.close();
  }
};

/** Reads public container geometry without deriving or accepting a password. */
export const inspectBec1File = async (
  inputPath: string
): Promise<Bec1ContainerInfo> => {
  const sourceStat = await openRegularFileStat(inputPath);
  const handle = await open(inputPath, "r");
  try {
    const [descriptor] = await readDescriptorCandidates(
      handle,
      sourceStat.size
    );
    return descriptor!.info;
  } finally {
    await handle.close();
  }
};

/** Opens a BEC1 file once and serves independently authenticated ranges. */
export const openBec1Container = async (
  inputPath: string,
  password: string
): Promise<Bec1OpenContainer> => {
  const sourceStat = await openRegularFileStat(inputPath);
  const handle = await open(inputPath, "r");
  let authenticated: AuthenticatedDescriptor;
  try {
    const candidates = await readDescriptorCandidates(handle, sourceStat.size);
    authenticated = await authenticateAnyDescriptor(candidates, password);
  } catch (error) {
    await handle.close();
    throw error;
  }

  const { descriptor, contentKey, manifest } = authenticated;
  authenticated.masterKey.fill(0);
  authenticated.fileKey.fill(0);
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Bec1Error("CLOSED", "The BEC1 container is closed.");
  };

  const iterateRange = async function* (
    range: Bec1ByteRange = {
      start: 0,
      endExclusive: descriptor.info.plaintextSize
    }
  ): AsyncIterable<Buffer> {
    assertOpen();
    validateRange(range, descriptor.info.plaintextSize);
    if (range.start === range.endExclusive) return;

    const firstChunk = Math.floor(range.start / descriptor.info.chunkSize);
    const lastChunk = Math.floor(
      (range.endExclusive - 1) / descriptor.info.chunkSize
    );
    for (
      let chunkIndex = firstChunk;
      chunkIndex <= lastChunk;
      chunkIndex += 1
    ) {
      assertOpen();
      const plaintextLength = expectedPlaintextChunkLength(
        descriptor.info,
        chunkIndex
      );
      const ciphertext = await readExact(
        handle,
        plaintextLength + BEC1_GCM_TAG_SIZE,
        chunkCiphertextOffset(descriptor.info, chunkIndex)
      );
      const plaintext = decryptAesGcm(
        ciphertext,
        contentKey,
        createChunkNonce(descriptor.noncePrefix, chunkIndex),
        createChunkAad(descriptor.info, chunkIndex, plaintextLength)
      );
      const chunkStart = chunkIndex * descriptor.info.chunkSize;
      const sliceStart = Math.max(0, range.start - chunkStart);
      const sliceEnd = Math.min(
        plaintextLength,
        range.endExclusive - chunkStart
      );
      const selected = Buffer.from(plaintext.subarray(sliceStart, sliceEnd));
      plaintext.fill(0);
      yield selected;
    }
  };

  return {
    info: descriptor.info,
    manifest,
    iterateRange,
    readRange: async (range) => {
      assertOpen();
      validateRange(range, descriptor.info.plaintextSize);
      if (range.endExclusive - range.start > BEC1_MAX_BUFFERED_RANGE_SIZE) {
        throw new Bec1Error(
          "INVALID_RANGE",
          "Buffered BEC1 ranges are limited to 64 MiB; use iterateRange instead."
        );
      }
      const parts: Buffer[] = [];
      for await (const part of iterateRange(range)) parts.push(part);
      return Buffer.concat(parts);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      contentKey.fill(0);
      await handle.close();
    }
  };
};

/** Decrypts a container atomically and verifies its recovery digest. */
export const decryptBec1File = async (
  options: DecryptBec1FileOptions
): Promise<Bec1RecoveryManifest> => {
  const container = await openBec1Container(
    options.inputPath,
    options.password
  );
  try {
    return await withAtomicOutput(
      resolve(options.outputPath),
      async (temporaryPath) => {
        const output = await open(temporaryPath, "wx", 0o600);
        const digest = createHash("sha256");
        let position = 0;
        try {
          for await (const plaintext of container.iterateRange()) {
            digest.update(plaintext);
            await writeAll(output, plaintext, position);
            position += plaintext.byteLength;
            plaintext.fill(0);
          }
          await output.sync();
        } finally {
          await output.close();
        }
        if (digest.digest("hex") !== container.manifest.plaintextSha256) {
          throw asAuthenticationError(new Error("Plaintext digest mismatch."));
        }
        return container.manifest;
      }
    );
  } finally {
    await container.close();
  }
};
