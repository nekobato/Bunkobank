import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import type { LibraryRecord } from "@bunkobank/db";

import { createEncryptedLibraryKeyring } from "./encrypted-library-keyring.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

it("locks after restart and unlocks from the password-wrapped key container", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunkobank-keyring-"));
  directories.push(directory);
  const storagePath = join(directory, "library");
  await mkdir(storagePath);
  const library: LibraryRecord = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    name: "Private",
    kind: "encrypted",
    rootPath: storagePath,
    canonicalRootPath: storagePath,
    createdAt: new Date(0),
    updatedAt: new Date(0)
  };
  const firstProcess = createEncryptedLibraryKeyring(join(directory, "cache"));

  await firstProcess.initialize(library, "correct password");
  expect(firstProcess.isUnlocked(library.id)).toBe(true);
  firstProcess.dispose();

  const restartedProcess = createEncryptedLibraryKeyring(
    join(directory, "other-cache")
  );
  expect(restartedProcess.isUnlocked(library.id)).toBe(false);
  await expect(
    restartedProcess.unlock(library, "wrong password")
  ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  await restartedProcess.unlock(library, "correct password");
  expect(restartedProcess.get(library.id)?.libraryId).toBe(library.id);
  restartedProcess.dispose();
});
