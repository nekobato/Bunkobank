#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { createBec1LibraryEncryptor } from "../dist/index.js";

const usage =
  "Usage: node emit-interop-container.mjs <input> <container> <password-file>";

const readPassword = async (path) =>
  (await readFile(path, "utf8")).replace(/\r?\n$/, "");

const run = async () => {
  const [inputPath, outputPath, passwordPath, ...rest] = process.argv.slice(2);
  if (!inputPath || !outputPath || !passwordPath || rest.length > 0) {
    throw new Error(usage);
  }

  const encryptor = await createBec1LibraryEncryptor({
    password: await readPassword(passwordPath)
  });
  try {
    const info = await encryptor.encryptFile({
      inputPath,
      outputPath,
      chunkSize: 64 * 1024,
      recovery: {
        originalName: "typescript-random.bin",
        mimeType: "application/octet-stream",
        mediaKind: "video",
        itemId: "fedcba98-7654-4321-8fed-cba987654321",
        assetRole: "original",
        sequence: 2,
        logicalPath: "Interop/TypeScript",
        modifiedAt: 1_700_000_000_001
      }
    });
    process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
  } finally {
    encryptor.dispose();
  }
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
