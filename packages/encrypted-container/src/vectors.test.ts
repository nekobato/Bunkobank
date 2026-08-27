import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  BEC1_DEFAULT_KDF,
  BEC1_DESCRIPTOR_SIZE,
  BEC1_GCM_TAG_SIZE
} from "./constants.js";
import { encryptBec1FileWithSecrets } from "./container.js";
import { deriveRecoveryKek, wrapKey } from "./crypto.js";

interface Bec1Vector {
  passwordCodePoints: number[];
  normalizedPasswordUtf8Hex: string;
  libraryId: string;
  assetId: string;
  masterKeyHex: string;
  fileKeyHex: string;
  kdfSaltHex: string;
  noncePrefixHex: string;
  manifestNonceHex: string;
  plaintext: { length: number; sha256: string };
  chunkSize: number;
  recovery: {
    originalName: string;
    mimeType: string;
    mediaKind: string;
    itemId: string;
    assetRole: string;
    sequence: number;
    logicalPath: string;
    modifiedAt: number;
  };
  expected: {
    recoveryKekHex: string;
    wrappedMasterKeyHex: string;
    containerSize: number;
    containerSha256: string;
    descriptorSha256: string;
    firstChunkSha256: string;
    finalChunkSha256: string;
  };
}

const sha256 = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

it("matches the published BEC1 version 1 interoperability vector", async () => {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const vector = JSON.parse(
    await readFile(
      join(sourceDirectory, "../test-vectors/bec1-v1.json"),
      "utf8"
    )
  ) as Bec1Vector;
  const directory = await mkdtemp(join(tmpdir(), "bunkobank-bec1-vector-"));
  const inputPath = join(directory, "input.bin");
  const outputPath = join(directory, "output.bbec");
  const plaintext = Buffer.alloc(vector.plaintext.length);
  for (let index = 0; index < plaintext.length; index += 1) {
    plaintext[index] = (index * 73 + 41) & 0xff;
  }

  const password = String.fromCodePoint(...vector.passwordCodePoints);
  const kdfSalt = Buffer.from(vector.kdfSaltHex, "hex");
  const masterKey = Buffer.from(vector.masterKeyHex, "hex");
  const recoveryKek = await deriveRecoveryKek(
    password,
    kdfSalt,
    BEC1_DEFAULT_KDF
  );
  const wrappedMasterKey = await wrapKey(recoveryKek, masterKey);

  try {
    expect(Buffer.from(password.normalize("NFC"), "utf8").toString("hex")).toBe(
      vector.normalizedPasswordUtf8Hex
    );
    expect(recoveryKek.toString("hex")).toBe(vector.expected.recoveryKekHex);
    expect(wrappedMasterKey.toString("hex")).toBe(
      vector.expected.wrappedMasterKeyHex
    );
    expect(sha256(plaintext)).toBe(vector.plaintext.sha256);
    await writeFile(inputPath, plaintext);
    await encryptBec1FileWithSecrets(
      {
        libraryId: vector.libraryId,
        masterKey,
        kdf: BEC1_DEFAULT_KDF,
        kdfSalt,
        wrappedMasterKey
      },
      {
        inputPath,
        outputPath,
        chunkSize: vector.chunkSize,
        recovery: vector.recovery
      },
      {
        assetId: vector.assetId,
        fileKey: Buffer.from(vector.fileKeyHex, "hex"),
        noncePrefix: Buffer.from(vector.noncePrefixHex, "hex"),
        manifestNonce: Buffer.from(vector.manifestNonceHex, "hex")
      }
    );

    const container = await readFile(outputPath);
    const firstChunkLength = vector.chunkSize + BEC1_GCM_TAG_SIZE;
    expect(container.byteLength).toBe(vector.expected.containerSize);
    expect(sha256(container)).toBe(vector.expected.containerSha256);
    expect(sha256(container.subarray(0, BEC1_DESCRIPTOR_SIZE))).toBe(
      vector.expected.descriptorSha256
    );
    expect(
      sha256(
        container.subarray(
          BEC1_DESCRIPTOR_SIZE,
          BEC1_DESCRIPTOR_SIZE + firstChunkLength
        )
      )
    ).toBe(vector.expected.firstChunkSha256);
    expect(
      sha256(
        container.subarray(
          BEC1_DESCRIPTOR_SIZE + firstChunkLength,
          container.byteLength - BEC1_DESCRIPTOR_SIZE
        )
      )
    ).toBe(vector.expected.finalChunkSha256);
    expect(
      container
        .subarray(0, BEC1_DESCRIPTOR_SIZE)
        .equals(container.subarray(-BEC1_DESCRIPTOR_SIZE))
    ).toBe(true);
  } finally {
    recoveryKek.fill(0);
    masterKey.fill(0);
    wrappedMasterKey.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
});
