import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  archiveBook,
  cancelJob,
  closeDatabase,
  connectDatabase,
  createJob,
  createLibrary,
  createScanFailure,
  deleteLibrary,
  findBookDetail,
  findBookPage,
  findJob,
  findLibrary,
  getLibraryPreference,
  hasActiveLibraryJobs,
  listArchivedBookSummaries,
  listBookPages,
  listBookSummaryPage,
  listBookSummaries,
  listJobs,
  listLibraries,
  listScanFailures,
  markBookScanError,
  markBooksMissingAfterScan,
  markJobCompleted,
  markJobRunning,
  markMissingBooksForLibrary,
  migrateDatabase,
  openBookCafeDatabase,
  persistScannedBook,
  restoreBook,
  setBookThumbnail,
  setLibraryPreference,
  updateBookMetadata,
  updateLibrary,
  updateReadingProgress,
  type BookCafeDatabase
} from "./library.js";

const tempDirs: string[] = [];

/**
 * Opens a temporary database with a minimal Better Auth user table.
 */
const createTestDatabase = (): {
  database: BookCafeDatabase;
  directory: string;
} => {
  const directory = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
  tempDirs.push(directory);
  const database = openBookCafeDatabase(join(directory, "bookcafe.sqlite"));

  database.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY
    );
    INSERT OR IGNORE INTO user (id) VALUES ('user-1'), ('user-2');
  `);

  return { database, directory };
};

/**
 * Persists a two-page image-folder book for a library.
 */
const createBook = (
  database: BookCafeDatabase,
  libraryId: string,
  relativePath = "Volume 1"
) =>
  persistScannedBook(database, {
    libraryId,
    relativePath,
    title: relativePath,
    authors: ["Author"],
    format: "image-folder",
    pageCount: 2,
    size: 2400,
    mtimeMs: 1000,
    fingerprint: `${relativePath}|2400|1000`,
    pages: [
      {
        pageNumber: 1,
        sourceType: "file",
        relativePath: `${relativePath}/001.jpg`,
        mimeType: "image/jpeg"
      },
      {
        pageNumber: 2,
        sourceType: "file",
        relativePath: `${relativePath}/002.jpg`,
        mimeType: "image/jpeg"
      }
    ]
  });

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("single database library model", () => {
  it("adds the scan marker column when opening an older books table", () => {
    const directory = mkdtempSync(join(tmpdir(), "bookcafe-db-migration-"));
    tempDirs.push(directory);
    const database = connectDatabase(join(directory, "bookcafe.sqlite"));

    try {
      database.sqlite.exec(`
        CREATE TABLE libraries (
          id TEXT PRIMARY KEY
        );
        CREATE TABLE books (
          id TEXT PRIMARY KEY,
          library_id TEXT NOT NULL,
          archived_at INTEGER
        );
      `);

      migrateDatabase(database);

      expect(
        (
          database.sqlite.pragma("table_info(books)") as Array<{
            name: string;
          }>
        ).map((column) => column.name)
      ).toContain("last_seen_scan_id");
    } finally {
      closeDatabase(database);
    }
  });

  it("creates named libraries and rejects duplicate names and overlapping roots", () => {
    const { database, directory } = createTestDatabase();

    try {
      const manga = createLibrary(database, {
        name: "Manga",
        rootPath: join(directory, "Manga"),
        canonicalRootPath: join(directory, "Manga")
      });

      expect(listLibraries(database)).toEqual([
        expect.objectContaining({
          id: manga.id,
          name: "Manga",
          rootPath: join(directory, "Manga")
        })
      ]);
      expect(() =>
        createLibrary(database, {
          name: "manga",
          rootPath: join(directory, "Other"),
          canonicalRootPath: join(directory, "Other")
        })
      ).toThrow(expect.objectContaining({ code: "LIBRARY_NAME_CONFLICT" }));
      expect(() =>
        createLibrary(database, {
          name: "Subfolder",
          rootPath: join(directory, "Manga", "Nested"),
          canonicalRootPath: join(directory, "Manga", "Nested")
        })
      ).toThrow(expect.objectContaining({ code: "LIBRARY_PATH_CONFLICT" }));
    } finally {
      closeDatabase(database);
    }
  });

  it("keeps book ids when only the library root path changes", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const book = createBook(database, library.id);

      const updated = updateLibrary(database, library.id, {
        rootPath: join(directory, "Renamed Books"),
        canonicalRootPath: join(directory, "Renamed Books")
      });

      expect(updated).toEqual(
        expect.objectContaining({
          id: library.id,
          rootPath: join(directory, "Renamed Books")
        })
      );
      expect(findBookDetail(database, library.id, book.id, "user-1")?.id).toBe(
        book.id
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("scopes books and lookups to one library", () => {
    const { database, directory } = createTestDatabase();

    try {
      const first = createLibrary(database, {
        name: "First",
        rootPath: join(directory, "First"),
        canonicalRootPath: join(directory, "First")
      });
      const second = createLibrary(database, {
        name: "Second",
        rootPath: join(directory, "Second"),
        canonicalRootPath: join(directory, "Second")
      });
      const firstBook = createBook(database, first.id, "Alpha");
      createBook(database, second.id, "Beta");

      expect(
        listBookSummaries(database, first.id, "user-1").map(
          (book) => book.title
        )
      ).toEqual(["Alpha"]);
      expect(
        findBookDetail(database, second.id, firstBook.id, "user-1")
      ).toBeNull();
    } finally {
      closeDatabase(database);
    }
  });

  it("filters and limits book summary pages inside SQLite", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      createBook(database, library.id, "Alpha");
      const beta = createBook(database, library.id, "Beta");
      createBook(database, library.id, "Gamma");
      updateBookMetadata(database, library.id, beta.id, {
        title: "Beta",
        authors: ["Author"],
        publisher: null,
        isbn: null,
        purchasedAt: null,
        readingStatus: "finished",
        tags: ["Favorite"],
        notes: null
      });

      expect(
        listBookSummaryPage(database, library.id, {
          query: "a",
          bookStatus: "ready",
          offset: 1,
          limit: 1,
          userId: "user-1"
        })
      ).toMatchObject({
        total: 3,
        offset: 1,
        limit: 1,
        hasMore: true,
        books: [expect.objectContaining({ title: "Beta" })]
      });
      expect(
        listBookSummaryPage(database, library.id, {
          readingStatus: "finished"
        })
      ).toMatchObject({
        total: 1,
        books: [expect.objectContaining({ id: beta.id })]
      });
    } finally {
      closeDatabase(database);
    }
  });

  it("atomically replaces pages and clamps every user's reading progress", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const book = createBook(database, library.id);

      updateReadingProgress(database, "user-1", library.id, book.id, 2);
      updateReadingProgress(database, "user-2", library.id, book.id, 2);
      persistScannedBook(database, {
        libraryId: library.id,
        relativePath: "Volume 1",
        title: "Volume 1",
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourceType: "file",
            relativePath: "Volume 1/new-cover.jpg",
            mimeType: "image/jpeg"
          }
        ]
      });

      expect(listBookPages(database, library.id, book.id)).toEqual([
        expect.objectContaining({
          pageNumber: 1,
          relativePath: "Volume 1/new-cover.jpg"
        })
      ]);
      expect(findBookPage(database, library.id, book.id, 2)).toBeNull();
      expect(
        findBookDetail(database, library.id, book.id, "user-1")?.currentPage
      ).toBe(1);
      expect(
        findBookDetail(database, library.id, book.id, "user-2")?.currentPage
      ).toBe(1);
    } finally {
      closeDatabase(database);
    }
  });

  it("accepts a dot locator for an image-folder book at the library root", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Root Book",
        rootPath: join(directory, "Root Book"),
        canonicalRootPath: join(directory, "Root Book")
      });
      const book = persistScannedBook(database, {
        libraryId: library.id,
        relativePath: ".",
        title: "Root Book",
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourceType: "file",
            relativePath: "001.jpg",
            mimeType: "image/jpeg"
          }
        ]
      });

      expect(book.relativePath).toBe(".");
    } finally {
      closeDatabase(database);
    }
  });

  it("archives books without deleting pages and restores them separately", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const book = createBook(database, library.id);
      updateBookMetadata(database, library.id, book.id, {
        title: "Edited",
        authors: ["Editor"],
        publisher: null,
        isbn: null,
        purchasedAt: null,
        readingStatus: "reading",
        tags: ["Favorite"],
        notes: null
      });
      updateReadingProgress(database, "user-1", library.id, book.id, 2);

      expect(archiveBook(database, library.id, book.id)).not.toBeNull();
      expect(listBookSummaries(database, library.id, "user-1")).toEqual([]);
      expect(listArchivedBookSummaries(database, library.id, "user-1")).toEqual(
        [
          expect.objectContaining({
            id: book.id,
            title: "Edited",
            currentPage: 2,
            tags: ["Favorite"]
          })
        ]
      );
      expect(listBookPages(database, library.id, book.id)).toHaveLength(2);

      const ignoredRescan = createBook(database, library.id);
      expect(ignoredRescan.archivedAt).not.toBeNull();
      expect(listBookPages(database, library.id, book.id)).toHaveLength(2);

      expect(restoreBook(database, library.id, book.id)?.archivedAt).toBeNull();
      expect(listBookSummaries(database, library.id, "user-1")).toHaveLength(1);
    } finally {
      closeDatabase(database);
    }
  });

  it("marks a parse failure as error without deleting the existing page snapshot", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const book = createBook(database, library.id, "Broken.cbz");

      expect(markBookScanError(database, library.id, "Broken.cbz")).toBe(true);
      expect(findBookDetail(database, library.id, book.id, "user-1")).toEqual(
        expect.objectContaining({
          status: "error",
          pageCount: 2
        })
      );
      expect(listBookPages(database, library.id, book.id)).toHaveLength(2);
      expect(markBookScanError(database, library.id, "New Broken.cbz")).toBe(
        false
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("treats a moved source as a new book and excludes archived books from missing updates", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const original = createBook(database, library.id, "Original");
      const archived = createBook(database, library.id, "Archived");
      archiveBook(database, library.id, archived.id);
      const moved = createBook(database, library.id, "Moved");

      expect(moved.id).not.toBe(original.id);
      expect(markMissingBooksForLibrary(database, library.id, ["Moved"])).toBe(
        1
      );
      expect(
        findBookDetail(database, library.id, original.id, "user-1")?.status
      ).toBe("missing");
      expect(
        findBookDetail(database, library.id, archived.id, "user-1")?.status
      ).toBe("ready");
    } finally {
      closeDatabase(database);
    }
  });

  it("marks only books not seen by a completed scan as missing", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const missing = createBook(database, library.id, "Missing");
      const failed = createBook(database, library.id, "Broken.cbz");
      const archived = createBook(database, library.id, "Archived");
      archiveBook(database, library.id, archived.id);
      persistScannedBook(database, {
        libraryId: library.id,
        relativePath: "Current",
        title: "Current",
        format: "image-folder",
        pageCount: 1,
        scanId: "scan-current",
        pages: [
          {
            pageNumber: 1,
            sourceType: "file",
            relativePath: "Current/001.jpg"
          }
        ]
      });
      markBookScanError(database, library.id, "Broken.cbz", "scan-current");

      expect(
        markBooksMissingAfterScan(database, library.id, "scan-current")
      ).toBe(1);
      expect(
        findBookDetail(database, library.id, missing.id, "user-1")?.status
      ).toBe("missing");
      expect(
        findBookDetail(database, library.id, failed.id, "user-1")?.status
      ).toBe("error");
      expect(
        findBookDetail(database, library.id, archived.id, "user-1")?.status
      ).toBe("ready");
    } finally {
      closeDatabase(database);
    }
  });

  it("stores jobs and selected library in the same database", () => {
    const { database, directory } = createTestDatabase();

    try {
      const first = createLibrary(database, {
        name: "First",
        rootPath: join(directory, "First"),
        canonicalRootPath: join(directory, "First")
      });
      const second = createLibrary(database, {
        name: "Second",
        rootPath: join(directory, "Second"),
        canonicalRootPath: join(directory, "Second")
      });
      const job = createJob(database, {
        libraryId: first.id,
        type: "scan-library",
        payload: { detected: 0 }
      });

      setLibraryPreference(database, "user-1", first.id);
      expect(getLibraryPreference(database, "user-1")).toBe(first.id);
      expect(listJobs(database, first.id)).toHaveLength(1);
      expect(listJobs(database, second.id)).toEqual([]);
      expect(findJob(database, second.id, job.id)).toBeNull();
      expect(hasActiveLibraryJobs(database, first.id)).toBe(true);

      markJobRunning(database, job.id);
      expect(cancelJob(database, first.id, job.id)).toBe("cancelled");
      expect(hasActiveLibraryJobs(database, first.id)).toBe(false);
    } finally {
      closeDatabase(database);
    }
  });

  it("stores and paginates path-safe failures within one scan job", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const otherLibrary = createLibrary(database, {
        name: "Other",
        rootPath: join(directory, "Other"),
        canonicalRootPath: join(directory, "Other")
      });
      const job = createJob(database, {
        libraryId: library.id,
        type: "scan-library",
        payload: {}
      });

      createScanFailure(database, {
        jobId: job.id,
        kind: "book",
        relativePath: "Broken.pdf",
        format: "pdf",
        code: "PDF_INVALID_HEADER"
      });
      createScanFailure(database, {
        jobId: job.id,
        kind: "subtree",
        relativePath: "Unreadable",
        format: "unknown",
        code: "DIRECTORY_UNREADABLE"
      });

      expect(
        listScanFailures(database, library.id, job.id, {
          offset: 0,
          limit: 1
        })
      ).toEqual(
        expect.objectContaining({
          total: 2,
          offset: 0,
          limit: 1,
          hasMore: true,
          failures: [
            expect.objectContaining({
              relativePath: "Broken.pdf",
              code: "PDF_INVALID_HEADER"
            })
          ]
        })
      );
      expect(listScanFailures(database, otherLibrary.id, job.id)).toBeNull();
    } finally {
      closeDatabase(database);
    }
  });

  it("deletes only library metadata and returns central thumbnail paths for cleanup", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const book = createBook(database, library.id);
      const thumbnailPath = join(
        directory,
        "state",
        "thumbnails",
        "cover.webp"
      );

      setBookThumbnail(database, {
        libraryId: library.id,
        bookId: book.id,
        path: thumbnailPath,
        page: 1,
        width: 320,
        height: 480
      });
      setLibraryPreference(database, "user-1", library.id);

      expect(deleteLibrary(database, library.id)).toEqual({
        status: "deleted",
        thumbnailPaths: [thumbnailPath]
      });
      expect(findLibrary(database, library.id)).toBeNull();
      expect(getLibraryPreference(database, "user-1")).toBeNull();
      expect(
        database.sqlite.prepare("SELECT COUNT(*) AS value FROM books").get()
      ).toEqual({ value: 0 });
    } finally {
      closeDatabase(database);
    }
  });

  it("refuses to update or delete a library while a scan job is active", () => {
    const { database, directory } = createTestDatabase();

    try {
      const library = createLibrary(database, {
        name: "Books",
        rootPath: join(directory, "Books"),
        canonicalRootPath: join(directory, "Books")
      });
      const job = createJob(database, {
        libraryId: library.id,
        type: "scan-library",
        payload: {}
      });

      expect(updateLibrary(database, library.id, { name: "Renamed" })).toEqual({
        status: "busy"
      });
      expect(deleteLibrary(database, library.id)).toEqual({ status: "busy" });

      markJobRunning(database, job.id);
      markJobCompleted(database, job.id);
      expect(updateLibrary(database, library.id, { name: "Renamed" })).toEqual(
        expect.objectContaining({ name: "Renamed" })
      );
    } finally {
      closeDatabase(database);
    }
  });
});
