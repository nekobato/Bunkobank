import { describe, expect, it } from "vitest";

import {
  apiErrorResponseSchema,
  backgroundJobSchema,
  bookDetailSchema,
  bookListQuerySchema,
  initialSetupRequestSchema,
  libraryCreateRequestSchema,
  librarySchema,
  libraryUpdateRequestSchema,
  pageSchema,
  scanFailureListQuerySchema,
  scanFailureListResponseSchema,
  updateLibraryPreferenceRequestSchema,
  updateBookMetadataRequestSchema
} from "./index.js";

describe("backgroundJobSchema", () => {
  it("describes cancellable and cancelled jobs", () => {
    expect(
      backgroundJobSchema.parse({
        id: "job-1",
        libraryId: "library-1",
        type: "scan-library",
        status: "cancelled",
        payload: { detected: 12, archived: 2 },
        progress: 35,
        error: null,
        canCancel: false,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:01:00.000Z"
      })
    ).toMatchObject({
      libraryId: "library-1",
      status: "cancelled",
      progress: 35,
      canCancel: false
    });
  });
});

describe("scan failure schemas", () => {
  it("normalizes bounded pagination and path-safe diagnostics", () => {
    expect(
      scanFailureListQuerySchema.parse({ offset: "20", limit: "50" })
    ).toEqual({
      offset: 20,
      limit: 50
    });
    expect(
      scanFailureListResponseSchema.parse({
        failures: [
          {
            id: "failure-1",
            jobId: "job-1",
            kind: "book",
            relativePath: "Broken.pdf",
            format: "pdf",
            code: "PDF_INVALID_HEADER",
            createdAt: "2026-07-27T00:00:00.000Z"
          }
        ],
        total: 1,
        offset: 0,
        limit: 100,
        hasMore: false
      })
    ).toMatchObject({
      total: 1,
      failures: [
        expect.objectContaining({
          relativePath: "Broken.pdf",
          code: "PDF_INVALID_HEADER"
        })
      ]
    });
  });
});

describe("initialSetupRequestSchema", () => {
  it("accepts only the initial username and password", () => {
    expect(
      initialSetupRequestSchema.parse({
        username: " admin ",
        password: "password123",
        dataDir: "/legacy/state",
        collectionRoots: ["/legacy/books"],
        host: "0.0.0.0",
        port: 9000,
        thumbnails: { enabled: false }
      })
    ).toEqual({
      username: "admin",
      password: "password123"
    });
  });

  it("matches Better Auth username and password length limits", () => {
    expect(() =>
      initialSetupRequestSchema.parse({
        username: "ab",
        password: "password123"
      })
    ).toThrow();
    expect(() =>
      initialSetupRequestSchema.parse({
        username: "a".repeat(31),
        password: "password123"
      })
    ).toThrow();
    expect(() =>
      initialSetupRequestSchema.parse({
        username: "invalid-name",
        password: "password123"
      })
    ).toThrow();
    expect(() =>
      initialSetupRequestSchema.parse({
        username: "admin",
        password: "p".repeat(129)
      })
    ).toThrow();
  });
});

describe("apiErrorResponseSchema", () => {
  it("accepts stable setup error codes", () => {
    expect(
      apiErrorResponseSchema.parse({
        code: "LIBRARY_BUSY",
        message: "Library has an active job."
      })
    ).toEqual({
      code: "LIBRARY_BUSY",
      message: "Library has an active job."
    });
  });
});

describe("library schemas", () => {
  it("normalizes create and update requests", () => {
    expect(
      libraryCreateRequestSchema.parse({
        name: " Manga ",
        rootPath: " /Volumes/Books/Manga "
      })
    ).toEqual({
      name: "Manga",
      rootPath: "/Volumes/Books/Manga"
    });

    expect(
      libraryUpdateRequestSchema.parse({
        name: " Archive ",
        rootPath: " /Volumes/Books/Archive "
      })
    ).toEqual({
      name: "Archive",
      rootPath: "/Volumes/Books/Archive"
    });
  });

  it("describes one named library with one server-side root", () => {
    expect(
      librarySchema.parse({
        id: "library-1",
        name: "Manga",
        rootPath: "/Volumes/Books/Manga",
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z"
      })
    ).toMatchObject({
      id: "library-1",
      name: "Manga",
      rootPath: "/Volumes/Books/Manga"
    });
  });

  it("requires a nullable selected library id for user preferences", () => {
    expect(
      updateLibraryPreferenceRequestSchema.parse({ libraryId: null })
    ).toEqual({ libraryId: null });
  });
});

describe("bookListQuerySchema", () => {
  it("accepts optional reading and book status filters", () => {
    expect(
      bookListQuerySchema.parse({
        q: " manga ",
        readingStatus: "finished",
        bookStatus: "missing"
      })
    ).toEqual({
      q: "manga",
      readingStatus: "finished",
      bookStatus: "missing",
      offset: 0,
      limit: 100
    });
  });

  it("treats empty status filters as absent", () => {
    expect(
      bookListQuerySchema.parse({
        q: "",
        readingStatus: "",
        bookStatus: ""
      })
    ).toEqual({
      q: "",
      readingStatus: undefined,
      bookStatus: undefined,
      offset: 0,
      limit: 100
    });
  });

  it("coerces bounded book-list pagination", () => {
    expect(bookListQuerySchema.parse({ offset: "100", limit: "50" })).toEqual({
      readingStatus: undefined,
      bookStatus: undefined,
      offset: 100,
      limit: 50
    });
    expect(() => bookListQuerySchema.parse({ limit: "101" })).toThrow();
  });
});

describe("updateBookMetadataRequestSchema", () => {
  it("trims text fields and converts empty nullable fields to null", () => {
    expect(
      updateBookMetadataRequestSchema.parse({
        title: " Edited Volume ",
        authors: [" Author "],
        publisher: "",
        isbn: " 9780000000000 ",
        purchasedAt: "",
        readingStatus: "finished",
        tags: [" Manga "],
        notes: " "
      })
    ).toEqual({
      title: "Edited Volume",
      authors: ["Author"],
      publisher: null,
      isbn: "9780000000000",
      purchasedAt: null,
      readingStatus: "finished",
      tags: ["Manga"],
      notes: null
    });
  });
});

describe("book and page schemas", () => {
  it("never exposes an absolute source path in book detail", () => {
    expect(
      bookDetailSchema.parse({
        id: "book-1",
        libraryId: "library-1",
        relativePath: "Volume 1",
        title: "Volume 1",
        authors: ["Author"],
        format: "image-folder",
        status: "ready",
        readingStatus: "finished",
        tags: ["Favorite"],
        pageCount: 12,
        currentPage: 3,
        thumbnailUrl: null,
        archivedAt: null,
        readingDirection: "rtl",
        publisher: null,
        isbn: null,
        purchasedAt: null,
        notes: null,
        sourcePath: "/Volumes/Books/Volume 1"
      })
    ).not.toHaveProperty("sourcePath");
  });

  it("describes a page with format-specific relative locators", () => {
    expect(
      pageSchema.parse({
        bookId: "book-1",
        pageNumber: 1,
        sourceType: "packed-archive-entry",
        relativePath: "Volume 1.7z",
        entryPath: "001.jpg",
        sourcePageNumber: null,
        width: 1200,
        height: 1800,
        mimeType: "image/jpeg",
        createdAt: "2026-07-23T00:00:00.000Z"
      })
    ).toMatchObject({
      sourceType: "packed-archive-entry",
      relativePath: "Volume 1.7z",
      entryPath: "001.jpg"
    });
  });
});
