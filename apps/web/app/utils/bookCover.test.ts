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
      formatLabel: "画像",
      pageLabel: "24ページ",
      accessibleName: "The Long Bookを読む（表紙画像なし）"
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
      pageLabel: "1ページ"
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
    expect(getBookCoverFormatLabel("unknown")).toBe("書籍");
  });
});
