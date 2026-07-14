import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import {
  detectFileFormat,
  listArchiveImageEntries,
  listEpubPages,
  listPackedArchiveImageEntries,
  listPdfPages,
  readArchiveImageEntry,
  readEpubMetadata,
  readPackedArchiveImageEntry,
  renderEpubPageImage,
  renderPdfPageImage
} from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("archive image helpers", () => {
  it("lists readable archive image entries in natural page order", async () => {
    const archivePath = join(mkdirTempDir(), "volume.cbz");
    writeFileSync(
      archivePath,
      zipSync({
        "pages/010.png": new Uint8Array([10]),
        "pages/002.png": new Uint8Array([2]),
        "pages/001.png": new Uint8Array([1]),
        "pages/notes.txt": new Uint8Array([99]),
        "__MACOSX/pages/003.png": new Uint8Array([3]),
        "pages/._004.png": new Uint8Array([4])
      })
    );

    const entries = await listArchiveImageEntries(archivePath);
    const pageData = await readArchiveImageEntry(archivePath, "pages/002.png");
    const nonImageData = await readArchiveImageEntry(
      archivePath,
      "pages/notes.txt"
    );

    expect(entries).toEqual([
      { entryPath: "pages/001.png", size: 1 },
      { entryPath: "pages/002.png", size: 1 },
      { entryPath: "pages/010.png", size: 1 }
    ]);
    expect(Array.from(pageData ?? [])).toEqual([2]);
    expect(nonImageData).toBeNull();
  });
});

describe("format detection", () => {
  it("detects book formats from file signatures without extensions", async () => {
    const dir = mkdirTempDir();
    const zipPath = join(dir, "volume-zip");
    const pdfPath = join(dir, "volume-pdf");
    const epubPath = join(dir, "volume-epub");
    const sevenZipPath = join(dir, "volume-seven");
    const rarPath = join(dir, "volume-rar");

    writeFileSync(
      zipPath,
      zipSync({
        "001.png": new Uint8Array([1])
      })
    );
    writeFileSync(pdfPath, createTestPdf(), "binary");
    writeFileSync(epubPath, createTestEpub());
    writeFileSync(sevenZipPath, createTestSevenZipArchive());
    writeFileSync(rarPath, createRarSignature());

    await expect(detectFileFormat(zipPath, false)).resolves.toBe("zip");
    await expect(detectFileFormat(pdfPath, false)).resolves.toBe("pdf");
    await expect(detectFileFormat(epubPath, false)).resolves.toBe("epub");
    await expect(detectFileFormat(sevenZipPath, false)).resolves.toBe(
      "seven-zip"
    );
    await expect(detectFileFormat(rarPath, false)).resolves.toBe("rar");
  });

  it("preserves comic archive extensions for generic archive signatures", async () => {
    const dir = mkdirTempDir();
    const cbzPath = join(dir, "volume.cbz");
    const cbrPath = join(dir, "volume.cbr");

    writeFileSync(
      cbzPath,
      zipSync({
        "001.png": new Uint8Array([1])
      })
    );
    writeFileSync(cbrPath, createRarSignature());

    await expect(detectFileFormat(cbzPath, false)).resolves.toBe("cbz");
    await expect(detectFileFormat(cbrPath, false)).resolves.toBe("cbr");
  });
});

describe("packed archive image helpers", () => {
  it("lists readable 7z image entries and reads one entry", async () => {
    const archivePath = join(mkdirTempDir(), "volume.7z");
    writeFileSync(archivePath, createTestSevenZipArchive());

    const entries = await listPackedArchiveImageEntries(archivePath);
    const pageData = await readPackedArchiveImageEntry(
      archivePath,
      "pages/002.png"
    );
    const nonImageData = await readPackedArchiveImageEntry(
      archivePath,
      "pages/notes.txt"
    );

    expect(entries).toEqual([
      { entryPath: "pages/001.png", size: 70 },
      { entryPath: "pages/002.png", size: 70 }
    ]);
    expect(pageData?.slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    );
    expect(nonImageData).toBeNull();
  });
});

describe("PDF helpers", () => {
  it("lists PDF pages and renders a page to PNG data", async () => {
    const pdfPath = join(mkdirTempDir(), "volume.pdf");
    writeFileSync(pdfPath, createTestPdf(), "binary");

    const pages = await listPdfPages(pdfPath);
    const firstPage = await renderPdfPageImage(pdfPath, 1, { scale: 1 });
    const outOfRangePage = await renderPdfPageImage(pdfPath, 2, { scale: 1 });

    expect(pages).toEqual([{ pageNumber: 1, width: 200, height: 260 }]);
    expect(firstPage?.slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    );
    expect(outOfRangePage).toBeNull();
  });

  it("rejects malformed PDFs without unhandled loading task rejections", async () => {
    const pdfPath = join(mkdirTempDir(), "broken.pdf");
    const unhandledReasons: unknown[] = [];
    const handleUnhandledRejection = (reason: unknown): void => {
      unhandledReasons.push(reason);
    };

    writeFileSync(
      pdfPath,
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "binary"
    );

    process.on("unhandledRejection", handleUnhandledRejection);

    try {
      await expect(listPdfPages(pdfPath)).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandledReasons).toEqual([]);
    } finally {
      process.off("unhandledRejection", handleUnhandledRejection);
    }
  });
});

describe("EPUB helpers", () => {
  it("lists EPUB spine pages and renders a page to PNG data", async () => {
    const epubPath = join(mkdirTempDir(), "volume.epub");
    writeFileSync(epubPath, createTestEpub());

    const pages = await listEpubPages(epubPath);
    const firstPage = await renderEpubPageImage(epubPath, 1);
    const outOfRangePage = await renderEpubPageImage(epubPath, 2);

    expect(pages).toEqual([
      {
        pageNumber: 1,
        width: 800,
        height: 1200,
        sourceHref: "OEBPS/chapter1.xhtml"
      }
    ]);
    expect(firstPage?.slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    );
    expect(outOfRangePage).toBeNull();
  });

  it("reads EPUB title and author metadata", async () => {
    const epubPath = join(mkdirTempDir(), "volume.epub");
    writeFileSync(epubPath, createTestEpub());

    await expect(readEpubMetadata(epubPath)).resolves.toEqual({
      title: "Test EPUB",
      authors: ["Test Author"]
    });
  });
});

/**
 * Creates a temporary directory tracked for cleanup.
 */
const mkdirTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "bookcafe-format-adapters-"));
  tempDirs.push(dir);
  return dir;
};

/**
 * Creates a tiny valid PDF with one colored page.
 */
const createTestPdf = (): string => {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    [
      "3 0 obj\n",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 260] ",
      "/Contents 4 0 R /Resources << >> >>\n",
      "endobj\n"
    ].join(""),
    [
      "4 0 obj\n",
      "<< /Length 28 >>\n",
      "stream\n",
      "0.9 0.2 0.3 rg\n",
      "0 0 200 260 re\n",
      "f\n",
      "endstream\n",
      "endobj\n"
    ].join("")
  ];
  let content = "%PDF-1.4\n";
  const offsets: number[] = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(content, "binary"));
    content += object;
  }

  const xrefOffset = Buffer.byteLength(content, "binary");
  content += `xref\n0 ${objects.length + 1}\n`;
  content += "0000000000 65535 f \n";

  for (const offset of offsets.slice(1)) {
    content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  content += [
    "trailer\n",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    "startxref\n",
    `${xrefOffset}\n`,
    "%%EOF\n"
  ].join("");

  return content;
};

/**
 * Creates a minimal EPUB with one XHTML spine item.
 */
const createTestEpub = (): Uint8Array =>
  zipSync({
    mimetype: new TextEncoder().encode("application/epub+zip"),
    "META-INF/container.xml": new TextEncoder().encode(
      [
        '<?xml version="1.0"?>',
        '<container version="1.0" ',
        'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
        "<rootfiles>",
        '<rootfile full-path="OEBPS/content.opf" ',
        'media-type="application/oebps-package+xml"/>',
        "</rootfiles>",
        "</container>"
      ].join("")
    ),
    "OEBPS/content.opf": new TextEncoder().encode(
      [
        '<?xml version="1.0"?>',
        '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">',
        "<metadata>",
        '<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">',
        "Test EPUB",
        "</dc:title>",
        '<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">',
        "Test Author",
        "</dc:creator>",
        "</metadata>",
        "<manifest>",
        '<item id="chapter1" href="chapter1.xhtml" ',
        'media-type="application/xhtml+xml"/>',
        "</manifest>",
        "<spine>",
        '<itemref idref="chapter1"/>',
        "</spine>",
        "</package>"
      ].join("")
    ),
    "OEBPS/chapter1.xhtml": new TextEncoder().encode(
      [
        '<?xml version="1.0"?>',
        '<html xmlns="http://www.w3.org/1999/xhtml">',
        "<head><title>Chapter 1</title></head>",
        "<body>",
        "<h1>Chapter One</h1>",
        "<p>Hello from EPUB content.</p>",
        "</body>",
        "</html>"
      ].join("")
    )
  });

/**
 * Creates a real 7z archive containing two PNG pages and one ignored text file.
 */
const createTestSevenZipArchive = (): Uint8Array =>
  Uint8Array.from(
    Buffer.from(
      [
        "N3q8ryccAATLcz7q2QAAAAAAAAAiAAAAAAAAAOnnYCjgAJIATV0ARJQFxHon",
        "9vfuiY5QkIizqtVQIJYzd/penA8ly9BiL+x00+opEvTeaycPPvyWxLnJq1",
        "S7Vm51kpHgB1hngh1o0fZTziMC5oXrtLnilwAAAACBMweuD9MB9D1AwJ",
        "DS/31pTY8XLDFjednXkYg/UHJw/lEUPtqcNHi2CAb5Smj0UYqPm/h2V",
        "bt9EL46al3Six0j+9IaiRgW6Mq91hnzYKLDTUXlHUiRcL5yR8/KPSF+",
        "lMtUnHxP22+zeKDLXZQ1n8kASjaOR0uAUVsNgUxlDWpMAAAAFwZVAQm",
        "AhAAHCwEAASMDAQEFXQAQAAAMgN4KAbHV3pcAAA=="
      ].join(""),
      "base64"
    )
  );

/**
 * Creates just enough RAR v4 bytes for signature-based detection.
 */
const createRarSignature = (): Uint8Array =>
  new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
