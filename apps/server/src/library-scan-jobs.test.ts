import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  archiveBook,
  closeDatabase,
  createJob,
  createLibrary,
  findJob,
  listBookSummaries,
  listScanFailures,
  openBookCafeDatabase,
  persistScannedBook
} from "@bookcafe/db";
import { afterEach, describe, expect, it } from "vitest";

import { runLibraryScanJob } from "./library-scan-jobs.js";

import type { ScannedBook } from "@bookcafe/scanner";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runLibraryScanJob", () => {
  it("persists each yielded book before requesting the next scan result", async () => {
    const fixture = createFixture();
    let firstBookWasPersisted = false;

    await runLibraryScanJob(
      {
        databasePath: fixture.databasePath,
        thumbnailDir: join(fixture.directory, "thumbnails"),
        thumbnailsEnabled: false,
        libraryId: fixture.libraryId,
        jobId: fixture.jobId
      },
      {
        scanLibrary: async function* () {
          yield createScannedImageBook("Volume 1");
          const database = openBookCafeDatabase(fixture.databasePath);

          try {
            firstBookWasPersisted =
              listBookSummaries(database, fixture.libraryId).length === 1;
          } finally {
            closeDatabase(database);
          }

          yield createScannedImageBook("Volume 2");
        }
      }
    );

    const database = openBookCafeDatabase(fixture.databasePath);

    try {
      expect(firstBookWasPersisted).toBe(true);
      expect(listBookSummaries(database, fixture.libraryId)).toHaveLength(2);
      expect(findJob(database, fixture.libraryId, fixture.jobId)?.status).toBe(
        "completed"
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("keeps incrementally persisted books without finalizing missing state after a fatal scan error", async () => {
    const fixture = createFixture();
    const database = openBookCafeDatabase(fixture.databasePath);

    try {
      persistScannedBook(database, {
        libraryId: fixture.libraryId,
        relativePath: "Existing",
        title: "Existing",
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourceType: "file",
            relativePath: "Existing/001.jpg"
          }
        ]
      });
    } finally {
      closeDatabase(database);
    }

    await runLibraryScanJob(
      {
        databasePath: fixture.databasePath,
        thumbnailDir: join(fixture.directory, "thumbnails"),
        thumbnailsEnabled: false,
        libraryId: fixture.libraryId,
        jobId: fixture.jobId
      },
      {
        scanLibrary: async function* () {
          yield createScannedImageBook("Volume 1");
          throw new Error("fatal scan error");
        }
      }
    );

    const verified = openBookCafeDatabase(fixture.databasePath);

    try {
      expect(listBookSummaries(verified, fixture.libraryId)).toEqual([
        expect.objectContaining({
          relativePath: "Existing",
          status: "ready"
        }),
        expect.objectContaining({
          relativePath: "Volume 1",
          status: "ready"
        })
      ]);
      expect(findJob(verified, fixture.libraryId, fixture.jobId)?.status).toBe(
        "failed"
      );
    } finally {
      closeDatabase(verified);
    }
  });

  it("persists relative scan results and completes the library job", async () => {
    const fixture = createFixture();
    const bookDirectory = join(fixture.rootPath, "Volume 1");
    mkdirSync(bookDirectory, { recursive: true });
    writeFileSync(join(bookDirectory, "001.jpg"), "first");
    writeFileSync(join(bookDirectory, "002.jpg"), "second");

    await runLibraryScanJob({
      databasePath: fixture.databasePath,
      thumbnailDir: join(fixture.directory, "thumbnails"),
      thumbnailsEnabled: false,
      libraryId: fixture.libraryId,
      jobId: fixture.jobId
    });

    const database = openBookCafeDatabase(fixture.databasePath);

    try {
      expect(listBookSummaries(database, fixture.libraryId)).toEqual([
        expect.objectContaining({
          relativePath: "Volume 1",
          pageCount: 2,
          status: "ready"
        })
      ]);
      expect(findJob(database, fixture.libraryId, fixture.jobId)).toEqual(
        expect.objectContaining({
          status: "completed",
          payload: {
            detected: 1,
            updated: 0,
            created: 1,
            missing: 0,
            archived: 0,
            failed: 0
          }
        })
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("skips archived source paths and reports missing visible books", async () => {
    const fixture = createFixture();
    const database = openBookCafeDatabase(fixture.databasePath);

    try {
      const archived = persistScannedBook(database, {
        libraryId: fixture.libraryId,
        relativePath: "Archived",
        title: "Archived",
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourceType: "file",
            relativePath: "Archived/001.jpg"
          }
        ]
      });
      persistScannedBook(database, {
        libraryId: fixture.libraryId,
        relativePath: "Missing",
        title: "Missing",
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourceType: "file",
            relativePath: "Missing/001.jpg"
          }
        ]
      });
      archiveBook(database, fixture.libraryId, archived.id);
    } finally {
      closeDatabase(database);
    }

    const archivedDirectory = join(fixture.rootPath, "Archived");
    mkdirSync(archivedDirectory, { recursive: true });
    writeFileSync(join(archivedDirectory, "001.jpg"), "archived");

    await runLibraryScanJob({
      databasePath: fixture.databasePath,
      thumbnailDir: join(fixture.directory, "thumbnails"),
      thumbnailsEnabled: false,
      libraryId: fixture.libraryId,
      jobId: fixture.jobId
    });

    const verified = openBookCafeDatabase(fixture.databasePath);

    try {
      expect(findJob(verified, fixture.libraryId, fixture.jobId)).toEqual(
        expect.objectContaining({
          status: "completed",
          payload: expect.objectContaining({
            archived: 1,
            missing: 1
          })
        })
      );
    } finally {
      closeDatabase(verified);
    }
  });

  it("marks an existing broken book as error without making it missing", async () => {
    const fixture = createFixture();
    const database = openBookCafeDatabase(fixture.databasePath);

    try {
      persistScannedBook(database, {
        libraryId: fixture.libraryId,
        relativePath: "Broken.cbz",
        title: "Broken",
        format: "cbz",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourceType: "archive-entry",
            relativePath: "Broken.cbz",
            entryPath: "001.jpg"
          }
        ]
      });
    } finally {
      closeDatabase(database);
    }

    writeFileSync(join(fixture.rootPath, "Broken.cbz"), "not-a-zip");

    await runLibraryScanJob({
      databasePath: fixture.databasePath,
      thumbnailDir: join(fixture.directory, "thumbnails"),
      thumbnailsEnabled: false,
      libraryId: fixture.libraryId,
      jobId: fixture.jobId
    });

    const verified = openBookCafeDatabase(fixture.databasePath);

    try {
      expect(listBookSummaries(verified, fixture.libraryId)).toEqual([
        expect.objectContaining({
          relativePath: "Broken.cbz",
          status: "error",
          pageCount: 1
        })
      ]);
      expect(findJob(verified, fixture.libraryId, fixture.jobId)).toEqual(
        expect.objectContaining({
          status: "completed",
          payload: expect.objectContaining({
            detected: 0,
            failed: 1,
            missing: 0
          })
        })
      );
    } finally {
      closeDatabase(verified);
    }
  });

  it("continues after an isolated PDF failure and marks only that book as error", async () => {
    const fixture = createFixture();
    const database = openBookCafeDatabase(fixture.databasePath);

    try {
      persistScannedBook(database, {
        libraryId: fixture.libraryId,
        relativePath: "Broken.pdf",
        title: "Broken",
        format: "pdf",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourceType: "pdf-page",
            relativePath: "Broken.pdf",
            sourcePageNumber: 1
          }
        ]
      });
    } finally {
      closeDatabase(database);
    }

    writeFileSync(join(fixture.rootPath, "Broken.pdf"), "%PDF-1.7\n");
    writeFileSync(join(fixture.rootPath, "Readable.pdf"), "%PDF-1.7\n");

    await runLibraryScanJob(
      {
        databasePath: fixture.databasePath,
        thumbnailDir: join(fixture.directory, "thumbnails"),
        thumbnailsEnabled: false,
        libraryId: fixture.libraryId,
        jobId: fixture.jobId
      },
      {
        listPdfPages: async (pdfPath) => {
          if (pdfPath.endsWith("Broken.pdf")) {
            throw Object.assign(new Error("PDF processing failed."), {
              code: "PDF_PROCESS_FAILED"
            });
          }

          return [{ pageNumber: 1, width: 200, height: 260 }];
        }
      }
    );

    const verified = openBookCafeDatabase(fixture.databasePath);

    try {
      expect(listBookSummaries(verified, fixture.libraryId)).toEqual([
        expect.objectContaining({
          relativePath: "Broken.pdf",
          status: "error"
        }),
        expect.objectContaining({
          relativePath: "Readable.pdf",
          status: "ready"
        })
      ]);
      expect(findJob(verified, fixture.libraryId, fixture.jobId)).toEqual(
        expect.objectContaining({
          status: "completed",
          payload: expect.objectContaining({
            detected: 1,
            failed: 1,
            missing: 0
          })
        })
      );
      expect(
        listScanFailures(verified, fixture.libraryId, fixture.jobId)
      ).toEqual(
        expect.objectContaining({
          total: 1,
          failures: [
            expect.objectContaining({
              relativePath: "Broken.pdf",
              format: "pdf",
              code: "PDF_PROCESS_FAILED"
            })
          ]
        })
      );
    } finally {
      closeDatabase(verified);
    }
  });

  it("stores a path-free error when a library scan fails", async () => {
    const fixture = createFixture();

    await runLibraryScanJob(
      {
        databasePath: fixture.databasePath,
        thumbnailDir: join(fixture.directory, "thumbnails"),
        thumbnailsEnabled: false,
        libraryId: fixture.libraryId,
        jobId: fixture.jobId
      },
      {
        scanLibrary: () => {
          throw new Error(`Cannot read ${fixture.rootPath}`);
        }
      }
    );

    const database = openBookCafeDatabase(fixture.databasePath);

    try {
      expect(findJob(database, fixture.libraryId, fixture.jobId)).toEqual(
        expect.objectContaining({
          status: "failed",
          error: "Library scan failed."
        })
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("keeps books in an unreadable subtree out of missing state", async () => {
    const fixture = createFixture();
    const database = openBookCafeDatabase(fixture.databasePath);

    try {
      persistScannedBook(database, {
        libraryId: fixture.libraryId,
        relativePath: "Unreadable/Volume",
        title: "Volume",
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourceType: "file",
            relativePath: "Unreadable/Volume/001.jpg"
          }
        ]
      });
    } finally {
      closeDatabase(database);
    }

    await runLibraryScanJob(
      {
        databasePath: fixture.databasePath,
        thumbnailDir: join(fixture.directory, "thumbnails"),
        thumbnailsEnabled: false,
        libraryId: fixture.libraryId,
        jobId: fixture.jobId
      },
      {
        scanLibrary: (_rootPath, options) => {
          options?.onCandidateError?.({
            kind: "subtree",
            relativePath: "Unreadable",
            format: "unknown",
            code: "DIRECTORY_UNREADABLE"
          });
          return streamScannedBooks([]);
        }
      }
    );

    const verified = openBookCafeDatabase(fixture.databasePath);

    try {
      expect(listBookSummaries(verified, fixture.libraryId)).toEqual([
        expect.objectContaining({
          relativePath: "Unreadable/Volume",
          status: "error"
        })
      ]);
      expect(findJob(verified, fixture.libraryId, fixture.jobId)).toEqual(
        expect.objectContaining({
          status: "completed",
          payload: expect.objectContaining({
            failed: 1,
            missing: 0
          })
        })
      );
    } finally {
      closeDatabase(verified);
    }
  });
});

/**
 * Creates one minimal scanner result for streaming persistence tests.
 */
const createScannedImageBook = (relativePath: string): ScannedBook => ({
  relativePath,
  title: relativePath,
  authors: [],
  format: "image-folder" as const,
  pagePaths: [`${relativePath}/001.jpg`],
  pages: [
    {
      sourceType: "file" as const,
      relativePath: `${relativePath}/001.jpg`,
      mimeType: "image/jpeg"
    }
  ],
  size: 1,
  mtimeMs: 1,
  fingerprint: `${relativePath}|1|1`
});

/**
 * Creates a scanner-compatible async stream from fixed test books.
 */
const streamScannedBooks = async function* (
  books: readonly ScannedBook[]
): AsyncGenerator<ScannedBook, void, void> {
  for (const book of books) {
    yield book;
  }
};

/**
 * Creates an isolated database, library, and queued scan job.
 */
const createFixture = (): {
  databasePath: string;
  directory: string;
  jobId: string;
  libraryId: string;
  rootPath: string;
} => {
  const directory = mkdtempSync(join(tmpdir(), "bookcafe-scan-job-"));
  tempDirs.push(directory);
  const databasePath = join(directory, "bookcafe.sqlite");
  const rootPath = join(directory, "library");
  mkdirSync(rootPath, { recursive: true });
  const database = openBookCafeDatabase(databasePath);

  try {
    database.sqlite.exec(
      'CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY)'
    );
    const library = createLibrary(database, {
      name: "Library",
      rootPath,
      canonicalRootPath: rootPath
    });
    const job = createJob(database, {
      libraryId: library.id,
      type: "scan-library",
      payload: {}
    });

    return {
      databasePath,
      directory,
      jobId: job.id,
      libraryId: library.id,
      rootPath
    };
  } finally {
    closeDatabase(database);
  }
};
