import type { BookFormat } from "@bookcafe/core";

export interface BookCoverPlaceholderInput {
  title: string;
  format: BookFormat;
  pageCount: number;
}

export interface BookCoverPlaceholder {
  initials: string;
  formatLabel: string;
  pageLabel: string;
  accessibleName: string;
}

/**
 * Creates the visible and accessible text for a book without a thumbnail.
 */
export const createBookCoverPlaceholder = (
  book: BookCoverPlaceholderInput
): BookCoverPlaceholder => ({
  initials: getBookCoverInitials(book.title),
  formatLabel: getBookCoverFormatLabel(book.format),
  pageLabel: getBookPageLabel(book.pageCount),
  accessibleName: `Read ${book.title}; no thumbnail available`
});

/**
 * Formats the short book format label shown on placeholder covers.
 */
export const getBookCoverFormatLabel = (format: BookFormat): string => {
  switch (format) {
    case "image-folder":
      return "Images";
    case "zip":
      return "ZIP";
    case "cbz":
      return "CBZ";
    case "pdf":
      return "PDF";
    case "epub":
      return "EPUB";
    case "rar":
      return "RAR";
    case "cbr":
      return "CBR";
    case "seven-zip":
      return "7z";
    default:
      return "Book";
  }
};

/**
 * Builds a compact title mark from the first two meaningful title segments.
 */
const getBookCoverInitials = (title: string): string => {
  const words = title
    .trim()
    .split(/[\s._-]+/u)
    .filter((word) => word.length > 0);
  const letters =
    words.length > 1
      ? words.slice(0, 2).flatMap((word) => Array.from(word).slice(0, 1))
      : Array.from(words[0] ?? title.trim()).slice(0, 2);
  const initials = letters.join("").toLocaleUpperCase();

  return initials || "BC";
};

/**
 * Formats the page count in the compact cover placeholder.
 */
const getBookPageLabel = (pageCount: number): string => {
  const safePageCount = Math.max(Math.trunc(pageCount), 1);
  return safePageCount === 1 ? "1 page" : `${safePageCount} pages`;
};
