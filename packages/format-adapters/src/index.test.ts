import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zipSync } from "fflate";
import { expect, it } from "vitest";

import { detectFileFormat } from "./index.js";

it("detects an archive book from its file signature", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bunkobank-format-"));
  const bookPath = join(directory, "book-without-extension");

  try {
    writeFileSync(
      bookPath,
      zipSync({ "001.png": new Uint8Array([137, 80, 78, 71]) })
    );

    await expect(detectFileFormat(bookPath, false)).resolves.toBe("zip");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
