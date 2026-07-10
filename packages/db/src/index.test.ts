import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  closeDatabase,
  createJob,
  deleteCollectionRoot,
  findBookPage,
  findCollectionRoot,
  listBookDetails,
  listBookSummaries,
  listJobs,
  markInterruptedJobsFailed,
  markMissingBooksForCollectionRoot,
  markJobCompleted,
  markJobRunning,
  openBookCafeDatabase,
  persistScannedBook,
  searchBookSummaries,
  setBookThumbnail,
  updateJobPayload,
  updateBookMetadata,
  updateBookCurrentPage,
  upsertCollectionRoot
} from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("BookCafe database", () => {
  it("persists collection roots, books, pages, progress, and jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const book = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Volume 1",
        authors: ["Author"],
        sourcePath: join(dir, "collection", "Volume 1"),
        format: "image-folder",
        pageCount: 2,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(dir, "collection", "Volume 1", "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(dir, "collection", "Volume 1", "002.jpg")
          }
        ]
      });
      const updated = updateBookCurrentPage(database, book.id, 2);
      const job = createJob(database, {
        type: "scan-collection-root",
        payload: { collectionRootId: root.id }
      });
      const updatedJob = updateJobPayload(database, job.id, {
        collectionRootId: root.id,
        discoveredBooks: 1
      });
      const completed = markJobCompleted(database, job.id);

      expect(listBookSummaries(database)).toEqual([
        expect.objectContaining({
          id: book.id,
          title: "Volume 1",
          authors: ["Author"],
          pageCount: 2,
          currentPage: 2
        })
      ]);
      expect(updated?.currentPage).toBe(2);
      expect(updatedJob?.payload).toEqual({
        collectionRootId: root.id,
        discoveredBooks: 1
      });
      expect(
        findBookPage(database, book.id, 2)?.sourcePath.endsWith("002.jpg")
      ).toBe(true);
      expect(findBookPage(database, book.id, 2)).toEqual(
        expect.objectContaining({
          sourceType: "file",
          entryPath: null
        })
      );
      expect(completed?.status).toBe("completed");
    } finally {
      closeDatabase(database);
    }
  });

  it("deletes only empty collection roots", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const emptyRoot = upsertCollectionRoot(
        database,
        join(dir, "empty-collection")
      );
      const populatedRoot = upsertCollectionRoot(
        database,
        join(dir, "populated-collection")
      );
      const sourcePath = join(dir, "populated-collection", "Volume 1");

      persistScannedBook(database, {
        collectionRootId: populatedRoot.id,
        title: "Volume 1",
        sourcePath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          }
        ]
      });

      expect(deleteCollectionRoot(database, "missing-root")).toBe("not-found");
      expect(deleteCollectionRoot(database, populatedRoot.id)).toBe(
        "has-books"
      );
      expect(deleteCollectionRoot(database, emptyRoot.id)).toBe("deleted");
      expect(findCollectionRoot(database, emptyRoot.id)).toBeNull();
      expect(findCollectionRoot(database, populatedRoot.id)).toEqual(
        expect.objectContaining({
          id: populatedRoot.id
        })
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("updates user-editable metadata without changing source paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const sourcePath = join(dir, "collection", "Volume 1");
      const book = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Volume 1",
        authors: ["Scanner Author"],
        sourcePath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          }
        ]
      });

      const updated = updateBookMetadata(database, book.id, {
        title: "Edited Volume",
        authors: ["  Manual Author  ", "Manual Author", "Co Author"],
        publisher: " Publisher ",
        isbn: " 9780000000000 ",
        purchasedAt: "2026-07-09",
        readingStatus: "reading",
        tags: ["Manga", "Favorite", "Manga"],
        notes: " Shelf note "
      });
      const rescanned = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Scanner Title",
        authors: ["Scanner Author"],
        sourcePath,
        format: "image-folder",
        pageCount: 2,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          }
        ]
      });

      expect(updated).toEqual(
        expect.objectContaining({
          title: "Edited Volume",
          authors: ["Manual Author", "Co Author"],
          publisher: "Publisher",
          isbn: "9780000000000",
          purchasedAt: "2026-07-09",
          readingStatus: "reading",
          tags: ["Manga", "Favorite"],
          notes: "Shelf note",
          sourcePath
        })
      );
      expect(rescanned).toEqual(
        expect.objectContaining({
          title: "Edited Volume",
          authors: ["Manual Author", "Co Author"],
          pageCount: 2,
          sourcePath
        })
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("preserves reading progress across rescans", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const sourcePath = join(dir, "collection", "Progress Volume");
      const book = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Progress Volume",
        sourcePath,
        format: "image-folder",
        pageCount: 3,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          },
          {
            pageNumber: 3,
            sourcePath: join(sourcePath, "003.jpg")
          }
        ]
      });

      updateBookCurrentPage(database, book.id, 3);

      const expanded = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Progress Volume",
        sourcePath,
        format: "image-folder",
        pageCount: 5,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          },
          {
            pageNumber: 3,
            sourcePath: join(sourcePath, "003.jpg")
          },
          {
            pageNumber: 4,
            sourcePath: join(sourcePath, "004.jpg")
          },
          {
            pageNumber: 5,
            sourcePath: join(sourcePath, "005.jpg")
          }
        ]
      });

      updateBookCurrentPage(database, book.id, 5);

      const shrunk = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Progress Volume",
        sourcePath,
        format: "image-folder",
        pageCount: 2,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          }
        ]
      });

      expect(expanded).toEqual(
        expect.objectContaining({
          currentPage: 3,
          pageCount: 5
        })
      );
      expect(shrunk).toEqual(
        expect.objectContaining({
          currentPage: 2,
          pageCount: 2
        })
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("refreshes scan fingerprints and file stats across rescans", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const sourcePath = join(dir, "collection", "Changing Volume");
      const book = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Changing Volume",
        sourcePath,
        format: "image-folder",
        pageCount: 2,
        size: 1200,
        mtimeMs: 1000,
        fingerprint: `${sourcePath}|1200|1000`,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          }
        ]
      });

      updateBookCurrentPage(database, book.id, 2);

      const rescanned = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Changing Volume",
        sourcePath,
        format: "image-folder",
        pageCount: 3,
        size: 2400,
        mtimeMs: 2000,
        fingerprint: `${sourcePath}|2400|2000`,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          },
          {
            pageNumber: 3,
            sourcePath: join(sourcePath, "003.jpg")
          }
        ]
      });
      const scanState = database.sqlite
        .prepare("SELECT size, mtime_ms, fingerprint FROM books WHERE id = ?")
        .get(book.id) as
        | { size: number; mtime_ms: number; fingerprint: string | null }
        | undefined;

      expect(rescanned).toEqual(
        expect.objectContaining({
          currentPage: 2,
          pageCount: 3
        })
      );
      expect(scanState).toEqual({
        size: 2400,
        mtime_ms: 2000,
        fingerprint: `${sourcePath}|2400|2000`
      });
    } finally {
      closeDatabase(database);
    }
  });

  it("preserves saved thumbnail references across rescans", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const sourcePath = join(dir, "collection", "Thumbnail Volume");
      const book = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Thumbnail Volume",
        sourcePath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          }
        ]
      });
      const thumbnailPath = join(dir, "thumbnails", `${book.id}.webp`);

      setBookThumbnail(database, {
        bookId: book.id,
        path: thumbnailPath,
        page: 1,
        width: 320,
        height: 480
      });

      const rescanned = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Thumbnail Volume",
        sourcePath,
        format: "image-folder",
        pageCount: 2,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          }
        ]
      });

      expect(rescanned).toEqual(
        expect.objectContaining({
          id: book.id,
          pageCount: 2,
          thumbnailUrl: `/api/books/${book.id}/thumbnail`
        })
      );
    } finally {
      closeDatabase(database);
    }
  });

  it("searches persisted books by title, author metadata, and source path", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const alphaPath = join(dir, "collection", "Alpha Manga");
      const betaPath = join(dir, "collection", "Special Shelf", "Beta Novel");

      persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Alpha Manga",
        authors: ["Clamp"],
        sourcePath: alphaPath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(alphaPath, "001.jpg")
          }
        ]
      });
      persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Beta Novel",
        authors: ["Writer"],
        sourcePath: betaPath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(betaPath, "001.jpg")
          }
        ]
      });
      const betaBook = listBookSummaries(database).find(
        (book) => book.title === "Beta Novel"
      );

      if (!betaBook) {
        throw new Error("Beta Novel was not persisted.");
      }

      updateBookMetadata(database, betaBook.id, {
        title: "Beta Novel",
        authors: ["Writer"],
        publisher: null,
        isbn: null,
        purchasedAt: null,
        readingStatus: "unread",
        tags: ["Space Opera"],
        notes: null
      });

      expect(
        searchBookSummaries(database, "Alpha").map((book) => book.title)
      ).toEqual(["Alpha Manga"]);
      expect(
        searchBookSummaries(database, "Clamp").map((book) => book.title)
      ).toEqual(["Alpha Manga"]);
      expect(
        searchBookSummaries(database, "Special Shelf").map((book) => book.title)
      ).toEqual(["Beta Novel"]);
      expect(
        searchBookSummaries(database, "Space Opera").map((book) => book.title)
      ).toEqual(["Beta Novel"]);
      expect(searchBookSummaries(database, "missing")).toEqual([]);
    } finally {
      closeDatabase(database);
    }
  });

  it("lists persisted book details for library export", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const sourcePath = join(dir, "collection", "Export Volume");
      const book = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Export Volume",
        authors: ["Scanner Author"],
        sourcePath,
        format: "image-folder",
        pageCount: 4,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          },
          {
            pageNumber: 3,
            sourcePath: join(sourcePath, "003.jpg")
          },
          {
            pageNumber: 4,
            sourcePath: join(sourcePath, "004.jpg")
          }
        ]
      });

      updateBookCurrentPage(database, book.id, 3);
      updateBookMetadata(database, book.id, {
        title: "Exported Title",
        authors: ["Manual Author"],
        publisher: "Publisher",
        isbn: "9780000000000",
        purchasedAt: "2026-07-10",
        readingStatus: "finished",
        tags: ["Export"],
        notes: "Portable metadata"
      });

      expect(listBookDetails(database)).toEqual([
        expect.objectContaining({
          id: book.id,
          title: "Exported Title",
          authors: ["Manual Author"],
          sourcePath,
          readingStatus: "finished",
          tags: ["Export"],
          currentPage: 3,
          notes: "Portable metadata"
        })
      ]);
    } finally {
      closeDatabase(database);
    }
  });

  it("marks absent books missing within one collection root", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const otherRoot = upsertCollectionRoot(
        database,
        join(dir, "other-collection")
      );
      const activeSourcePath = join(dir, "collection", "Active Volume");

      persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Active Volume",
        sourcePath: activeSourcePath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(activeSourcePath, "001.jpg")
          }
        ]
      });
      persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Missing Volume",
        sourcePath: join(dir, "collection", "Missing Volume"),
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(dir, "collection", "Missing Volume", "001.jpg")
          }
        ]
      });
      persistScannedBook(database, {
        collectionRootId: otherRoot.id,
        title: "Other Volume",
        sourcePath: join(dir, "other-collection", "Other Volume"),
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(dir, "other-collection", "Other Volume", "001.jpg")
          }
        ]
      });

      const markedCount = markMissingBooksForCollectionRoot(database, root.id, [
        activeSourcePath
      ]);
      const booksByTitle = new Map(
        listBookSummaries(database).map((book) => [book.title, book])
      );

      expect(markedCount).toBe(1);
      expect(booksByTitle.get("Active Volume")?.status).toBe("ready");
      expect(booksByTitle.get("Missing Volume")?.status).toBe("missing");
      expect(booksByTitle.get("Other Volume")?.status).toBe("ready");
    } finally {
      closeDatabase(database);
    }
  });

  it("marks queued and running jobs failed after interruption", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-db-"));
    tempDirs.push(dir);
    const database = openBookCafeDatabase(join(dir, "bookcafe.sqlite"));

    try {
      const queuedJob = createJob(database, {
        type: "scan-collection-root",
        payload: { collectionRootId: "queued-root" }
      });
      const runningJob = createJob(database, {
        type: "scan-collection-root",
        payload: { collectionRootId: "running-root" }
      });
      const completedJob = createJob(database, {
        type: "scan-collection-root",
        payload: { collectionRootId: "completed-root" }
      });

      markJobRunning(database, runningJob.id);
      markJobCompleted(database, completedJob.id);

      const failedCount = markInterruptedJobsFailed(database);
      const jobsById = new Map(listJobs(database).map((job) => [job.id, job]));

      expect(failedCount).toBe(2);
      expect(jobsById.get(queuedJob.id)).toEqual(
        expect.objectContaining({
          status: "failed",
          progress: 100,
          error: "Job interrupted by server shutdown."
        })
      );
      expect(jobsById.get(runningJob.id)?.status).toBe("failed");
      expect(jobsById.get(completedJob.id)?.status).toBe("completed");
    } finally {
      closeDatabase(database);
    }
  });
});
