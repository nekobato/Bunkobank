import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zipSync } from "fflate";
import { expect, it } from "vitest";

import {
  closeDatabase,
  createLibrary,
  openBunkobankDatabase
} from "@bunkobank/db";

import { createEncryptedLibraryKeyring } from "./encrypted-library-keyring.js";
import {
  importEncryptedBook,
  withDecryptedSource
} from "./encrypted-library-files.js";

it("keeps the original and persists only a BEC1 asset while remaining readable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunkobank-import-"));
  const storagePath = join(directory, "encrypted");
  const sourcePath = join(directory, "example.cbz");
  const database = openBunkobankDatabase(join(directory, "bunkobank.sqlite"));
  const source = Buffer.from(
    zipSync({ "001.jpg": Uint8Array.from([1, 2, 3, 4]) })
  );

  try {
    await mkdir(storagePath);
    await writeFile(sourcePath, source);
    const library = createLibrary(database, {
      name: "Private",
      kind: "encrypted",
      rootPath: storagePath,
      canonicalRootPath: storagePath
    });
    const keyring = createEncryptedLibraryKeyring(join(directory, "cache"));
    await keyring.initialize(library, "correct password");
    const encryptor = keyring.get(library.id);
    expect(encryptor).not.toBeNull();

    const book = await importEncryptedBook({
      database,
      library,
      encryptor: encryptor!,
      sourcePath,
      originalName: "My Book.cbz",
      thumbnailDir: join(directory, "thumbnails"),
      thumbnailsEnabled: false
    });

    expect(book).toMatchObject({ title: "My Book", format: "cbz" });
    expect(await readFile(sourcePath)).toEqual(source);
    const assets = (await readdir(storagePath)).filter((name) =>
      name.endsWith(".bbec")
    );
    expect(assets).toHaveLength(2);
    expect(await readFile(join(storagePath, book!.relativePath))).not.toEqual(
      source
    );
    await withDecryptedSource(
      {
        library,
        relativePath: book!.relativePath,
        encryptor: encryptor!,
        cacheDir: join(directory, "plaintext")
      },
      async (decryptedPath) => {
        expect(await readFile(decryptedPath)).toEqual(source);
      }
    );
    keyring.dispose();
  } finally {
    closeDatabase(database);
    rmSync(directory, { recursive: true, force: true });
  }
});
