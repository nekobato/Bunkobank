import { describe, expect, it } from "vitest";

import {
  backgroundJobSchema,
  bookListQuerySchema,
  initialSetupRequestSchema,
  libraryExportResponseSchema,
  updateBookMetadataRequestSchema
} from "./index.js";

describe("backgroundJobSchema", () => {
  it("describes cancellable and cancelled jobs", () => {
    expect(
      backgroundJobSchema.parse({
        id: "job-1",
        type: "scan-collection-root",
        status: "cancelled",
        payload: { collectionRootId: "root-1" },
        progress: 35,
        error: null,
        canCancel: false,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:01:00.000Z"
      })
    ).toMatchObject({
      status: "cancelled",
      progress: 35,
      canCancel: false
    });
  });
});

describe("initialSetupRequestSchema", () => {
  it("applies default server network settings", () => {
    expect(
      initialSetupRequestSchema.parse({
        username: "admin",
        password: "password123"
      })
    ).toMatchObject({
      host: "127.0.0.1",
      port: 4510,
      thumbnails: { enabled: true }
    });
  });

  it("accepts explicit LAN bind mode and thumbnail settings", () => {
    expect(
      initialSetupRequestSchema.parse({
        username: "admin",
        password: "password123",
        host: "0.0.0.0",
        thumbnails: { enabled: false }
      })
    ).toMatchObject({
      host: "0.0.0.0",
      thumbnails: { enabled: false }
    });
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
      bookStatus: "missing"
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
      bookStatus: undefined
    });
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

describe("libraryExportResponseSchema", () => {
  it("accepts versioned library export data", () => {
    expect(
      libraryExportResponseSchema.parse({
        schemaVersion: 1,
        exportedAt: "2026-07-10T00:00:00.000Z",
        collectionRoots: [
          {
            id: "root-1",
            path: "/books",
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z"
          }
        ],
        books: [
          {
            id: "book-1",
            title: "Volume 1",
            authors: ["Author"],
            format: "image-folder",
            status: "ready",
            readingStatus: "finished",
            tags: ["Favorite"],
            pageCount: 12,
            currentPage: 3,
            thumbnailUrl: null,
            sourcePath: "/books/Volume 1",
            readingDirection: "rtl",
            publisher: null,
            isbn: null,
            purchasedAt: null,
            notes: null
          }
        ]
      })
    ).toMatchObject({
      schemaVersion: 1,
      books: [
        {
          title: "Volume 1",
          currentPage: 3
        }
      ]
    });
  });
});
