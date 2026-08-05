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
      expect.objectContaining({ id: library.id, name: "Books" })
    ]);
  } finally {
    closeDatabase(database);
    rmSync(directory, { recursive: true, force: true });
  }
});
