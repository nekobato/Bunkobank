import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { scanLibrary } from "./index.js";

it("discovers one image-folder book with naturally sorted pages", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunkobank-scanner-"));
  const bookDirectory = join(directory, "Volume 1");

  try {
    mkdirSync(bookDirectory);
    writeFileSync(join(bookDirectory, "10.jpg"), "ten");
    writeFileSync(join(bookDirectory, "2.jpg"), "two");

    const books = [];
    for await (const book of scanLibrary(directory)) {
      books.push(book);
    }

    expect(books).toEqual([
      expect.objectContaining({
        relativePath: "Volume 1",
        pagePaths: ["Volume 1/2.jpg", "Volume 1/10.jpg"]
      })
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
