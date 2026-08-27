#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  mkdtemp,
  open,
  readFile,
  rm,
  truncate,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const rustManifest = join(repositoryRoot, "tools/bec1-interop-rust/Cargo.toml");
const rustBinary = join(
  repositoryRoot,
  "tools/bec1-interop-rust/target/debug",
  process.platform === "win32" ? "bec1-interop.exe" : "bec1-interop"
);
const typescriptCli = join(
  repositoryRoot,
  "packages/encrypted-container/dist/cli.js"
);
const typescriptEmitter = join(
  repositoryRoot,
  "packages/encrypted-container/scripts/emit-interop-container.mjs"
);
const vectorPath = join(
  repositoryRoot,
  "packages/encrypted-container/test-vectors/bec1-v1.json"
);
const descriptorSize = 4096;
const gcmTagSize = 16;

const pass = (name) => process.stdout.write(`PASS ${name}\n`);

const runCommand = async (command, arguments_) =>
  executeFile(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });

const runJson = async (command, arguments_) => {
  const { stdout } = await runCommand(command, arguments_);
  return JSON.parse(stdout);
};

const pathExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const expectFailure = async (command, arguments_, expectedCode) => {
  try {
    await runCommand(command, arguments_);
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    assert.match(
      stderr,
      new RegExp(expectedCode),
      `Expected ${expectedCode}, received stderr: ${stderr}`
    );
    return;
  }
  assert.fail(`Expected ${expectedCode}, but the command succeeded.`);
};

const mutateByte = async (path, position) => {
  const handle = await open(path, "r+");
  try {
    const byte = Buffer.alloc(1);
    const { bytesRead } = await handle.read(byte, 0, 1, position);
    assert.equal(bytesRead, 1);
    byte[0] ^= 0x80;
    await handle.write(byte, 0, 1, position);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const sha256 = (source) => createHash("sha256").update(source).digest("hex");

const makeContent = (size) => {
  const result = Buffer.alloc(size);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = (index * 31 + 17) & 0xff;
  }
  return result;
};

const makeVectorContent = (size) => {
  const result = Buffer.alloc(size);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = (index * 73 + 41) & 0xff;
  }
  return result;
};

const rustInspect = (containerPath, passwordPath) =>
  runJson(rustBinary, [
    "inspect",
    containerPath,
    ...(passwordPath ? ["--password-file", passwordPath] : [])
  ]);

const rustDecrypt = (containerPath, outputPath, passwordPath) =>
  runJson(rustBinary, [
    "decrypt",
    containerPath,
    outputPath,
    "--password-file",
    passwordPath
  ]);

const typescriptInspect = (containerPath, passwordPath) =>
  runJson(process.execPath, [
    typescriptCli,
    "inspect",
    containerPath,
    ...(passwordPath ? ["--password-file", passwordPath] : []),
    "--json"
  ]);

const typescriptDecrypt = (containerPath, outputPath, passwordPath) =>
  runJson(process.execPath, [
    typescriptCli,
    "decrypt",
    containerPath,
    outputPath,
    "--password-file",
    passwordPath,
    "--json"
  ]);

const verifyVectorDigests = async (containerPath, vector) => {
  const container = await readFile(containerPath);
  const firstChunkLength = vector.chunkSize + gcmTagSize;
  assert.equal(container.length, vector.expected.containerSize);
  assert.equal(sha256(container), vector.expected.containerSha256);
  assert.equal(
    sha256(container.subarray(0, descriptorSize)),
    vector.expected.descriptorSha256
  );
  assert.equal(
    sha256(
      container.subarray(descriptorSize, descriptorSize + firstChunkLength)
    ),
    vector.expected.firstChunkSha256
  );
  assert.equal(
    sha256(
      container.subarray(
        descriptorSize + firstChunkLength,
        container.length - descriptorSize
      )
    ),
    vector.expected.finalChunkSha256
  );
};

const run = async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunkobank-bec1-interop-"));
  try {
    await runCommand("cargo", [
      "build",
      "--locked",
      "--manifest-path",
      rustManifest
    ]);
    pass("Rust CLI build");

    const passwordPath = join(directory, "password.txt");
    const wrongPasswordPath = join(directory, "wrong-password.txt");
    const inputPath = join(directory, "typescript-input.bin");
    const typescriptContainerPath = join(directory, "typescript.bbec");
    const content = makeContent(150 * 1024 + 37);
    await writeFile(passwordPath, "correct horse battery staple\n", {
      mode: 0o600
    });
    await writeFile(wrongPasswordPath, "incorrect password\n", {
      mode: 0o600
    });
    await writeFile(inputPath, content);

    const emittedInfo = await runJson(process.execPath, [
      typescriptEmitter,
      inputPath,
      typescriptContainerPath,
      passwordPath
    ]);
    assert.deepEqual(
      await typescriptInspect(typescriptContainerPath),
      emittedInfo
    );
    pass("TypeScript random container generation");

    const rustPublic = await rustInspect(typescriptContainerPath);
    assert.deepEqual(rustPublic, emittedInfo);
    const rustAuthenticated = await rustInspect(
      typescriptContainerPath,
      passwordPath
    );
    assert.deepEqual(
      {
        ...rustAuthenticated,
        recovery: undefined
      },
      {
        ...emittedInfo,
        recovery: undefined
      }
    );
    assert.deepEqual(rustAuthenticated.recovery, {
      version: 1,
      originalName: "typescript-random.bin",
      mimeType: "application/octet-stream",
      mediaKind: "video",
      itemId: "fedcba98-7654-4321-8fed-cba987654321",
      assetRole: "original",
      sequence: 2,
      logicalPath: "Interop/TypeScript",
      modifiedAt: 1_700_000_000_001,
      plaintextSha256: sha256(content)
    });
    const rustRecoveredPath = join(directory, "rust-recovered.bin");
    await rustDecrypt(typescriptContainerPath, rustRecoveredPath, passwordPath);
    assert.deepEqual(await readFile(rustRecoveredPath), content);
    pass("TypeScript to Rust inspect and decrypt");

    const vector = JSON.parse(await readFile(vectorPath, "utf8"));
    const vectorContainerPath = join(directory, "rust-vector.bbec");
    await runJson(rustBinary, ["emit-vector", vectorPath, vectorContainerPath]);
    await verifyVectorDigests(vectorContainerPath, vector);
    pass("Rust deterministic vector digests");

    const vectorPassword = String.fromCodePoint(...vector.passwordCodePoints);
    const vectorPasswordPath = join(directory, "vector-password.txt");
    await writeFile(vectorPasswordPath, vectorPassword, { mode: 0o600 });
    const typescriptVectorInspect = await typescriptInspect(
      vectorContainerPath,
      vectorPasswordPath
    );
    assert.equal(typescriptVectorInspect.libraryId, vector.libraryId);
    assert.equal(typescriptVectorInspect.assetId, vector.assetId);
    assert.deepEqual(typescriptVectorInspect.recovery, {
      version: 1,
      ...vector.recovery,
      plaintextSha256: vector.plaintext.sha256
    });
    const typescriptVectorRecoveredPath = join(
      directory,
      "typescript-vector-recovered.bin"
    );
    await typescriptDecrypt(
      vectorContainerPath,
      typescriptVectorRecoveredPath,
      vectorPasswordPath
    );
    assert.deepEqual(
      await readFile(typescriptVectorRecoveredPath),
      makeVectorContent(vector.plaintext.length)
    );
    pass("Rust to TypeScript inspect and decrypt");

    const mirrorContainerPath = join(directory, "mirror-recovery.bbec");
    await copyFile(typescriptContainerPath, mirrorContainerPath);
    await mutateByte(mirrorContainerPath, 0);
    const rustMirrorPath = join(directory, "rust-mirror.bin");
    const typescriptMirrorPath = join(directory, "typescript-mirror.bin");
    await rustDecrypt(mirrorContainerPath, rustMirrorPath, passwordPath);
    await typescriptDecrypt(
      mirrorContainerPath,
      typescriptMirrorPath,
      passwordPath
    );
    assert.deepEqual(await readFile(rustMirrorPath), content);
    assert.deepEqual(await readFile(typescriptMirrorPath), content);
    pass("Primary descriptor damage and mirror recovery");

    await expectFailure(
      rustBinary,
      [
        "inspect",
        typescriptContainerPath,
        "--password-file",
        wrongPasswordPath
      ],
      "AUTHENTICATION_FAILED"
    );
    await expectFailure(
      process.execPath,
      [
        typescriptCli,
        "inspect",
        typescriptContainerPath,
        "--password-file",
        wrongPasswordPath,
        "--json"
      ],
      "AUTHENTICATION_FAILED"
    );
    pass("Wrong password rejection");

    const tamperedChunkPath = join(directory, "tampered-chunk.bbec");
    await copyFile(typescriptContainerPath, tamperedChunkPath);
    await mutateByte(tamperedChunkPath, descriptorSize + 100);
    const rustTamperedOutput = join(directory, "rust-tampered.bin");
    const typescriptTamperedOutput = join(directory, "typescript-tampered.bin");
    await expectFailure(
      rustBinary,
      [
        "decrypt",
        tamperedChunkPath,
        rustTamperedOutput,
        "--password-file",
        passwordPath
      ],
      "AUTHENTICATION_FAILED"
    );
    await expectFailure(
      process.execPath,
      [
        typescriptCli,
        "decrypt",
        tamperedChunkPath,
        typescriptTamperedOutput,
        "--password-file",
        passwordPath,
        "--json"
      ],
      "AUTHENTICATION_FAILED"
    );
    assert.equal(await pathExists(rustTamperedOutput), false);
    assert.equal(await pathExists(typescriptTamperedOutput), false);
    pass("Chunk tamper rejection without plaintext output");

    const tamperedManifestPath = join(directory, "tampered-manifest.bbec");
    await copyFile(typescriptContainerPath, tamperedManifestPath);
    const containerSize = (await readFile(tamperedManifestPath)).length;
    await mutateByte(tamperedManifestPath, 224 + 5);
    await mutateByte(
      tamperedManifestPath,
      containerSize - descriptorSize + 224 + 5
    );
    await expectFailure(
      rustBinary,
      ["inspect", tamperedManifestPath, "--password-file", passwordPath],
      "AUTHENTICATION_FAILED"
    );
    await expectFailure(
      process.execPath,
      [
        typescriptCli,
        "inspect",
        tamperedManifestPath,
        "--password-file",
        passwordPath,
        "--json"
      ],
      "AUTHENTICATION_FAILED"
    );
    pass("Manifest tamper rejection");

    const truncatedPath = join(directory, "truncated.bbec");
    await copyFile(typescriptContainerPath, truncatedPath);
    await truncate(truncatedPath, containerSize - 1);
    await expectFailure(
      rustBinary,
      ["inspect", truncatedPath],
      "INVALID_CONTAINER"
    );
    await expectFailure(
      process.execPath,
      [typescriptCli, "inspect", truncatedPath, "--json"],
      "INVALID_CONTAINER"
    );
    pass("Truncation rejection");

    const sentinel = Buffer.from("do not overwrite");
    const rustExistingPath = join(directory, "rust-existing.bin");
    const typescriptExistingPath = join(directory, "typescript-existing.bin");
    await writeFile(rustExistingPath, sentinel);
    await writeFile(typescriptExistingPath, sentinel);
    await expectFailure(
      rustBinary,
      [
        "decrypt",
        typescriptContainerPath,
        rustExistingPath,
        "--password-file",
        passwordPath
      ],
      "OUTPUT_EXISTS"
    );
    await expectFailure(
      process.execPath,
      [
        typescriptCli,
        "decrypt",
        typescriptContainerPath,
        typescriptExistingPath,
        "--password-file",
        passwordPath,
        "--json"
      ],
      "OUTPUT_EXISTS"
    );
    assert.deepEqual(await readFile(rustExistingPath), sentinel);
    assert.deepEqual(await readFile(typescriptExistingPath), sentinel);
    pass("Existing output protection");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

run().catch((error) => {
  const message = error instanceof Error ? error.stack : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
