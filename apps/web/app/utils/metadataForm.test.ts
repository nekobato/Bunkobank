import { describe, expect, it } from "vitest";

import {
  createEmptyMetadataForm,
  toMetadataForm,
  toMetadataRequest
} from "./metadataForm";

describe("metadata form helpers", () => {
  it("creates an empty metadata form with the default reading status", () => {
    expect(createEmptyMetadataForm()).toEqual({
      title: "",
      authors: "",
      publisher: "",
      isbn: "",
      purchasedAt: "",
      readingStatus: "unread",
      tags: "",
      notes: ""
    });
  });

  it("converts a book detail response into editable text fields", () => {
    expect(
      toMetadataForm({
        id: "book-1",
        title: "Edited Book",
        authors: ["Author A", "Author B"],
        format: "cbz",
        status: "ready",
        readingStatus: "reading",
        tags: ["Manga", "Favorite"],
        pageCount: 120,
        currentPage: 12,
        thumbnailUrl: null,
        sourcePath: "/books/edited.cbz",
        readingDirection: "rtl",
        publisher: "Publisher",
        isbn: "9780000000001",
        purchasedAt: "2026-07-09",
        notes: "Private note"
      })
    ).toEqual({
      title: "Edited Book",
      authors: "Author A\nAuthor B",
      publisher: "Publisher",
      isbn: "9780000000001",
      purchasedAt: "2026-07-09",
      readingStatus: "reading",
      tags: "Manga, Favorite",
      notes: "Private note"
    });
  });

  it("converts editable text into a normalized metadata request", () => {
    expect(
      toMetadataRequest({
        title: "  Edited Book  ",
        authors: " Author A\nAuthor B, Author A, ",
        publisher: " ",
        isbn: "9780000000001",
        purchasedAt: "",
        readingStatus: "finished",
        tags: "Manga, Favorite\nManga",
        notes: "  Private note  "
      })
    ).toEqual({
      title: "  Edited Book  ",
      authors: ["Author A", "Author B"],
      publisher: null,
      isbn: "9780000000001",
      purchasedAt: null,
      readingStatus: "finished",
      tags: ["Manga", "Favorite"],
      notes: "Private note"
    });
  });
});
