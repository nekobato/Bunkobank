import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  closeDatabase,
  createLibrary,
  listLibraries,
  openBunkobankDatabase
} from "./library.js";

it("persists a library in the shared SQLite database", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunkobank-db-"));
  const database = openBunkobankDatabase(join(directory, "bunkobank.sqlite"));

  try {
    const library = createLibrary(database, {
      name: "Books",
      rootPath: join(directory, "Books"),
      canonicalRootPath: join(directory, "Books")
    });

    expect(listLibraries(database)).toEqual([
      expect.objectContaining({
        id: library.id,
        name: "Books",
        kind: "directory"
      })
    ]);
  } finally {
    closeDatabase(database);
    rmSync(directory, { recursive: true, force: true });
  }
});

it("persists encrypted library storage separately from directory libraries", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunkobank-db-"));
  const database = openBunkobankDatabase(join(directory, "bunkobank.sqlite"));

  try {
    const library = createLibrary(database, {
      name: "Private Books",
      kind: "encrypted",
      rootPath: join(directory, "Encrypted"),
      canonicalRootPath: join(directory, "Encrypted")
    });

    expect(library).toMatchObject({
      name: "Private Books",
      kind: "encrypted"
    });
  } finally {
    closeDatabase(database);
    rmSync(directory, { recursive: true, force: true });
  }
});
