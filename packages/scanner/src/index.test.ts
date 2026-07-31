import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import {
  scanLibrary,
  type ScanCandidateFailure,
  type ScannedBook
} from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scanLibrary", () => {
  it("stops before filesystem work when the scan is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      collectBooks(scanLibrary("/collection", { signal: controller.signal }))
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("yields each discovered book before the complete scan is collected", async () => {
    const root = join(mkdirTempDir(), "collection");
    const firstBookDir = join(root, "Volume 1");
    const secondBookDir = join(root, "Volume 2");
    mkdirSync(firstBookDir, { recursive: true });
    mkdirSync(secondBookDir, { recursive: true });
    writeFileSync(join(firstBookDir, "001.jpg"), "first");
    writeFileSync(join(secondBookDir, "001.jpg"), "second");

    const iterator = scanLibrary(root)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual(
      expect.objectContaining({
        done: false,
        value: expect.objectContaining({ relativePath: "Volume 1" })
      })
    );
    await expect(iterator.next()).resolves.toEqual(
      expect.objectContaining({
        done: false,
        value: expect.objectContaining({ relativePath: "Volume 2" })
      })
    );
    await expect(iterator.next()).resolves.toEqual(
      expect.objectContaining({ done: true })
    );
  });

  it("discovers nested image-folder books with naturally sorted pages", async () => {
    const root = join(mkdirTempDir(), "collection");
    const bookDir = join(root, "Volume 1");
    mkdirSync(bookDir, { recursive: true });
    writeFileSync(join(bookDir, "10.jpg"), "ten");
    writeFileSync(join(bookDir, "2.jpg"), "two");
    writeFileSync(join(bookDir, "cover.txt"), "ignored");

    const books = await collectBooks(scanLibrary(root));

    expect(books).toHaveLength(1);
    expect(books[0]?.title).toBe("Volume 1");
    expect(books[0]).toEqual(
      expect.objectContaining({
        relativePath: "Volume 1",
        pagePaths: ["Volume 1/2.jpg", "Volume 1/10.jpg"]
      })
    );
    expect(books[0]?.pages).toEqual([
      {
        sourceType: "file",
        relativePath: "Volume 1/2.jpg",
        mimeType: "image/jpeg"
      },
      {
        sourceType: "file",
        relativePath: "Volume 1/10.jpg",
        mimeType: "image/jpeg"
      }
    ]);
  });

  it("represents an image-folder library root with a relative dot locator", async () => {
    const root = join(mkdirTempDir(), "Root Volume");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "001.jpg"), "one");

    const books = await collectBooks(scanLibrary(root));

    expect(books).toEqual([
      expect.objectContaining({
        relativePath: ".",
        title: "Root Volume",
        pagePaths: ["001.jpg"]
      })
    ]);
  });

  it("discovers zip and cbz books with archive-entry pages", async () => {
    const root = join(mkdirTempDir(), "collection");
    const archivePath = join(root, "Volume Archive.cbz");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      archivePath,
      zipSync({
        "010.jpg": new Uint8Array([10]),
        "002.jpg": new Uint8Array([2]),
        "notes.txt": new Uint8Array([99])
      })
    );

    const books = await collectBooks(scanLibrary(root));

    expect(books).toHaveLength(1);
    expect(books[0]).toEqual(
      expect.objectContaining({
        relativePath: "Volume Archive.cbz",
        title: "Volume Archive",
        format: "cbz",
        pagePaths: ["002.jpg", "010.jpg"]
      })
    );
    expect(books[0]?.pages).toEqual([
      {
        sourceType: "archive-entry",
        relativePath: "Volume Archive.cbz",
        entryPath: "002.jpg",
        mimeType: "image/jpeg"
      },
      {
        sourceType: "archive-entry",
        relativePath: "Volume Archive.cbz",
        entryPath: "010.jpg",
        mimeType: "image/jpeg"
      }
    ]);
  });

  it("discovers PDF books with one page source per PDF page", async () => {
    const root = join(mkdirTempDir(), "collection");
    const pdfPath = join(root, "Volume PDF.pdf");
    mkdirSync(root, { recursive: true });
    writeFileSync(pdfPath, createTestPdf(), "binary");

    const books = await collectBooks(scanLibrary(root));

    expect(books).toHaveLength(1);
    expect(books[0]).toEqual(
      expect.objectContaining({
        relativePath: "Volume PDF.pdf",
        title: "Volume PDF",
        format: "pdf",
        pagePaths: ["page:1"]
      })
    );
    expect(books[0]?.pages).toEqual([
      {
        sourceType: "pdf-page",
        relativePath: "Volume PDF.pdf",
        sourcePageNumber: 1,
        width: 200,
        height: 260,
        mimeType: "image/png"
      }
    ]);
  });

  it("serializes PDF page discovery through the configured loader", async () => {
    const root = join(mkdirTempDir(), "collection");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "Volume 1.pdf"), createTestPdf(), "binary");
    writeFileSync(join(root, "Volume 2.pdf"), createTestPdf(), "binary");
    let activeLoads = 0;
    let maximumActiveLoads = 0;
    const receivedSignals: Array<AbortSignal | undefined> = [];
    const controller = new AbortController();

    const books = await collectBooks(
      scanLibrary(root, {
        concurrency: 8,
        listPdfPages: async (_pdfPath, signal) => {
          receivedSignals.push(signal);
          activeLoads += 1;
          maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeLoads -= 1;

          return [{ pageNumber: 1, width: 200, height: 260 }];
        },
        signal: controller.signal
      })
    );

    expect(maximumActiveLoads).toBe(1);
    expect(receivedSignals).toEqual([controller.signal, controller.signal]);
    expect(books.map((book) => book.relativePath)).toEqual([
      "Volume 1.pdf",
      "Volume 2.pdf"
    ]);
  });

  it("keeps a stable PDF process code in candidate failure diagnostics", async () => {
    const root = join(mkdirTempDir(), "collection");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "Slow.pdf"), createTestPdf(), "binary");
    const failures: ScanCandidateFailure[] = [];

    const books = await collectBooks(
      scanLibrary(root, {
        listPdfPages: async () => {
          throw Object.assign(new Error("private path omitted"), {
            code: "PDF_PROCESS_TIMEOUT"
          });
        },
        onCandidateError: (failure) => failures.push(failure)
      })
    );

    expect(books).toEqual([]);
    expect(failures).toEqual([
      {
        kind: "book",
        relativePath: "Slow.pdf",
        format: "pdf",
        code: "PDF_PROCESS_TIMEOUT"
      }
    ]);
  });

  it("keeps deterministic results when scan concurrency is low", async () => {
    const root = join(mkdirTempDir(), "collection");
    const imageBookDir = join(root, "Nested Image Volume");
    const archivePath = join(root, "Volume Archive.cbz");
    const pdfPath = join(root, "Volume PDF.pdf");
    mkdirSync(imageBookDir, { recursive: true });
    writeFileSync(join(imageBookDir, "001.jpg"), "image");
    writeFileSync(
      archivePath,
      zipSync({
        "001.jpg": new Uint8Array([1])
      })
    );
    writeFileSync(pdfPath, createTestPdf(), "binary");

    const books = await collectBooks(scanLibrary(root, { concurrency: 1 }));

    expect(
      books.map((book) => ({
        title: book.title,
        format: book.format,
        pagePaths: book.pagePaths
      }))
    ).toEqual([
      {
        title: "Volume Archive",
        format: "cbz",
        pagePaths: ["001.jpg"]
      },
      {
        title: "Volume PDF",
        format: "pdf",
        pagePaths: ["page:1"]
      },
      {
        title: "Nested Image Volume",
        format: "image-folder",
        pagePaths: ["Nested Image Volume/001.jpg"]
      }
    ]);
  });

  it("discovers EPUB books with generated page sources", async () => {
    const root = join(mkdirTempDir(), "collection");
    const epubPath = join(root, "Volume EPUB.epub");
    mkdirSync(root, { recursive: true });
    writeFileSync(epubPath, createTestEpub());

    const books = await collectBooks(scanLibrary(root));

    expect(books).toHaveLength(1);
    expect(books[0]).toEqual(
      expect.objectContaining({
        relativePath: "Volume EPUB.epub",
        title: "Test EPUB",
        authors: ["Test Author"],
        format: "epub",
        pagePaths: ["page:1"]
      })
    );
    expect(books[0]?.pages).toEqual([
      {
        sourceType: "epub-page",
        relativePath: "Volume EPUB.epub",
        sourcePageNumber: 1,
        width: 800,
        height: 1200,
        mimeType: "image/png"
      }
    ]);
  });

  it("discovers 7z books with packed-archive-entry pages", async () => {
    const root = join(mkdirTempDir(), "collection");
    const archivePath = join(root, "Volume Seven.7z");
    mkdirSync(root, { recursive: true });
    writeFileSync(archivePath, createTestSevenZipArchive());

    const books = await collectBooks(scanLibrary(root));

    expect(books).toHaveLength(1);
    expect(books[0]).toEqual(
      expect.objectContaining({
        relativePath: "Volume Seven.7z",
        title: "Volume Seven",
        format: "seven-zip",
        pagePaths: ["pages/001.png", "pages/002.png"]
      })
    );
    expect(books[0]?.pages).toEqual([
      {
        sourceType: "packed-archive-entry",
        relativePath: "Volume Seven.7z",
        entryPath: "pages/001.png",
        mimeType: "image/png"
      },
      {
        sourceType: "packed-archive-entry",
        relativePath: "Volume Seven.7z",
        entryPath: "pages/002.png",
        mimeType: "image/png"
      }
    ]);
  });

  it("discovers supported books by signature when extensions are missing", async () => {
    const root = join(mkdirTempDir(), "collection");
    mkdirSync(root, { recursive: true });

    const zipPath = join(root, "Volume ZIP");
    const pdfPath = join(root, "Volume PDF");
    const epubPath = join(root, "Volume EPUB");
    const sevenZipPath = join(root, "Volume Seven");
    writeFileSync(
      zipPath,
      zipSync({
        "001.jpg": new Uint8Array([1])
      })
    );
    writeFileSync(pdfPath, createTestPdf(), "binary");
    writeFileSync(epubPath, createTestEpub());
    writeFileSync(sevenZipPath, createTestSevenZipArchive());

    const books = await collectBooks(scanLibrary(root));

    expect(
      books.map((book) => ({
        relativePath: book.relativePath,
        title: book.title,
        format: book.format,
        pagePaths: book.pagePaths
      }))
    ).toEqual([
      {
        relativePath: "Volume ZIP",
        title: "Volume ZIP",
        format: "zip",
        pagePaths: ["001.jpg"]
      },
      {
        relativePath: "Volume PDF",
        title: "Volume PDF",
        format: "pdf",
        pagePaths: ["page:1"]
      },
      {
        relativePath: "Volume EPUB",
        title: "Test EPUB",
        format: "epub",
        pagePaths: ["page:1"]
      },
      {
        relativePath: "Volume Seven",
        title: "Volume Seven",
        format: "seven-zip",
        pagePaths: ["pages/001.png", "pages/002.png"]
      }
    ]);
  });

  it("reports unreadable file candidates without aborting the scan", async () => {
    const root = join(mkdirTempDir(), "collection");
    const archivePath = join(root, "Readable Archive.cbz");
    const brokenArchivePath = join(root, "Broken Archive.cbz");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      archivePath,
      zipSync({
        "001.jpg": new Uint8Array([1])
      })
    );
    writeFileSync(brokenArchivePath, "not-a-zip");

    const failures: ScanCandidateFailure[] = [];
    const books = await collectBooks(
      scanLibrary(root, {
        onCandidateError: (failure) => failures.push(failure)
      })
    );

    expect(books).toHaveLength(1);
    expect(books[0]).toEqual(
      expect.objectContaining({
        relativePath: "Readable Archive.cbz",
        title: "Readable Archive",
        format: "cbz"
      })
    );
    expect(failures).toEqual([
      {
        kind: "book",
        relativePath: "Broken Archive.cbz",
        format: "cbz",
        code: "ARCHIVE_PARSE_FAILED"
      }
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "reports an unreadable child directory as a failed subtree",
    async () => {
      const root = join(mkdirTempDir(), "collection");
      const unreadable = join(root, "Unreadable");
      mkdirSync(unreadable, { recursive: true });
      chmodSync(unreadable, 0o000);
      const failures: ScanCandidateFailure[] = [];

      try {
        expect(
          await collectBooks(
            scanLibrary(root, {
              onCandidateError: (failure) => failures.push(failure)
            })
          )
        ).toEqual([]);
      } finally {
        chmodSync(unreadable, 0o700);
      }

      expect(failures).toEqual([
        {
          kind: "subtree",
          relativePath: "Unreadable",
          format: "unknown",
          code: "DIRECTORY_UNREADABLE"
        }
      ]);
    }
  );

  it("excludes hidden and system filesystem entries from scanning", async () => {
    const root = join(mkdirTempDir(), "collection");
    const visibleBookDir = join(root, "Visible Volume");
    const hiddenBookDir = join(root, ".hidden-volume");
    const macosxBookDir = join(root, "__MACOSX", "Ignored Volume");
    const archivePath = join(root, "Readable Archive.cbz");
    const hiddenArchivePath = join(root, ".hidden-archive.cbz");
    mkdirSync(visibleBookDir, { recursive: true });
    mkdirSync(hiddenBookDir, { recursive: true });
    mkdirSync(macosxBookDir, { recursive: true });
    writeFileSync(join(visibleBookDir, "001.jpg"), "visible");
    writeFileSync(join(visibleBookDir, "._002.jpg"), "appledouble");
    writeFileSync(join(hiddenBookDir, "001.jpg"), "hidden");
    writeFileSync(join(macosxBookDir, "001.jpg"), "macosx");
    writeFileSync(
      archivePath,
      zipSync({
        "001.jpg": new Uint8Array([1])
      })
    );
    writeFileSync(
      hiddenArchivePath,
      zipSync({
        "001.jpg": new Uint8Array([1])
      })
    );

    const books = await collectBooks(scanLibrary(root));

    expect(
      books.map((book) => ({
        title: book.title,
        pagePaths: book.pagePaths.map((path) => path.split("/").at(-1))
      }))
    ).toEqual([
      {
        title: "Readable Archive",
        pagePaths: ["001.jpg"]
      },
      {
        title: "Visible Volume",
        pagePaths: ["001.jpg"]
      }
    ]);
  });

  it("skips archived relative paths before returning scan candidates", async () => {
    const root = join(mkdirTempDir(), "collection");
    const activeBookDir = join(root, "Active");
    const archivedBookDir = join(root, "Archived");
    mkdirSync(activeBookDir, { recursive: true });
    mkdirSync(archivedBookDir, { recursive: true });
    writeFileSync(join(activeBookDir, "001.jpg"), "active");
    writeFileSync(join(archivedBookDir, "001.jpg"), "archived");

    const books = await collectBooks(
      scanLibrary(root, {
        excludedRelativePaths: new Set(["Archived"])
      })
    );

    expect(books.map((book) => book.relativePath)).toEqual(["Active"]);
    expect(
      books.flatMap((book) => [
        book.relativePath,
        ...book.pages.flatMap((page) => page.relativePath ?? [])
      ])
    ).not.toContain(expect.stringContaining(root));
  });
});

/**
 * Collects a scan stream for assertions that need the complete result.
 */
const collectBooks = async (
  books: AsyncIterable<ScannedBook>
): Promise<ScannedBook[]> => {
  const collected: ScannedBook[] = [];

  for await (const book of books) {
    collected.push(book);
  }

  return collected;
};

/**
 * Creates a temporary directory tracked for cleanup.
 */
const mkdirTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "bookcafe-scanner-"));
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
