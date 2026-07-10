import { describe, expect, it } from "vitest";

import {
  createBookCoverPlaceholder,
  getBookCoverFormatLabel
} from "./bookCover";

describe("book cover placeholder", () => {
  it("creates concise initials from a multi-word title", () => {
    expect(
      createBookCoverPlaceholder({
        title: "The Long Book",
        format: "image-folder",
        pageCount: 24
      })
    ).toMatchObject({
      initials: "TL",
      formatLabel: "Images",
      pageLabel: "24 pages",
      accessibleName: "Read The Long Book; no thumbnail available"
    });
  });

  it("creates initials from filename-like titles", () => {
    expect(
      createBookCoverPlaceholder({
        title: "Charlotte_v01",
        format: "cbz",
        pageCount: 1
      })
    ).toMatchObject({
      initials: "CV",
      formatLabel: "CBZ",
      pageLabel: "1 page"
    });
  });

  it("keeps non-Latin title initials readable", () => {
    expect(
      createBookCoverPlaceholder({
        title: "猫本",
        format: "pdf",
        pageCount: 120
      })
    ).toMatchObject({
      initials: "猫本",
      formatLabel: "PDF"
    });
  });

  it("formats archive and ebook labels", () => {
    expect(getBookCoverFormatLabel("seven-zip")).toBe("7z");
    expect(getBookCoverFormatLabel("epub")).toBe("EPUB");
    expect(getBookCoverFormatLabel("unknown")).toBe("Book");
  });
});
