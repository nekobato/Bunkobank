/**
 * Shared domain types and small pure helpers for Bunkobank.
 */

export type ReaderMode = "paged" | "vertical";

export type ReadingDirection = "rtl" | "ltr";

export type PageLayout = "single" | "spread";

export type ReaderKeyboardAction =
  | "next-page"
  | "previous-page"
  | "first-page"
  | "last-page"
  | "zoom-in"
  | "zoom-out"
  | "reset-zoom";

export type BookFormat =
  | "image-folder"
  | "zip"
  | "cbz"
  | "pdf"
  | "epub"
  | "rar"
  | "cbr"
  | "seven-zip"
  | "unknown";

/** Stable source scopes recorded for one scan failure. */
export const scanFailureKinds = ["book", "subtree"] as const;

/** Source scope recorded for one scan failure. */
export type ScanFailureKind = (typeof scanFailureKinds)[number];

/** Stable, path-free reasons that can be persisted for scan diagnostics. */
export const scanFailureCodes = [
  "SOURCE_UNREADABLE",
  "DIRECTORY_UNREADABLE",
  "ARCHIVE_PARSE_FAILED",
  "EPUB_PARSE_FAILED",
  "PDF_APPLEDOUBLE_FILE",
  "PDF_INVALID_HEADER",
  "PDF_PARSE_FAILED",
  "PDF_PROCESS_TIMEOUT",
  "PDF_PROCESS_FAILED"
] as const;

/** Path-free reason recorded for one scan failure. */
export type ScanFailureCode = (typeof scanFailureCodes)[number];

export type BookStatus = "ready" | "scanning" | "missing" | "error";

export type ReadingStatus = "unread" | "reading" | "finished";

export interface BookSummary {
  id: string;
  libraryId: string;
  relativePath: string;
  title: string;
  authors: string[];
  format: BookFormat;
  status: BookStatus;
  readingStatus: ReadingStatus;
  tags: string[];
  pageCount: number;
  currentPage: number;
  thumbnailUrl: string | null;
  archivedAt: string | null;
}

export interface BookDetail extends BookSummary {
  readingDirection: ReadingDirection;
  publisher: string | null;
  isbn: string | null;
  purchasedAt: string | null;
  notes: string | null;
}

export interface ReaderSettings {
  mode: ReaderMode;
  direction: ReadingDirection;
  layout: PageLayout;
}

export interface ReaderShortcutInput {
  key: string;
  direction: ReadingDirection;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface PageAsset {
  bookId: string;
  page: number;
  width: number;
  height: number;
  imageUrl: string;
}

export const defaultReaderSettings: ReaderSettings = {
  mode: "paged",
  direction: "rtl",
  layout: "single"
};

/**
 * Clamps a one-based page number into a valid page range.
 */
export const clampPage = (page: number, pageCount: number): number => {
  if (!Number.isFinite(page) || pageCount < 1) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(page), 1), pageCount);
};

/**
 * Calculates the next page for a reader navigation step.
 */
export const getPageByStep = (
  currentPage: number,
  pageCount: number,
  step: number
): number => clampPage(currentPage + step, pageCount);

/**
 * Returns pages nearest to the current page, alternating previous and next.
 */
export const getAdjacentPages = (
  currentPage: number,
  pageCount: number,
  radius = 1
): number[] => {
  const page = clampPage(currentPage, pageCount);
  const safeRadius = Math.max(Math.trunc(radius), 0);
  const candidates: number[] = [];

  for (let offset = 1; offset <= safeRadius; offset += 1) {
    candidates.push(page - offset, page + offset);
  }

  return candidates.filter(
    (candidate, index, allCandidates) =>
      candidate >= 1 &&
      candidate <= pageCount &&
      candidate !== page &&
      allCandidates.indexOf(candidate) === index
  );
};

/**
 * Returns the first visible page in a paged reader spread.
 */
export const getSpreadAnchorPage = (
  currentPage: number,
  pageCount: number
): number => {
  const page = clampPage(currentPage, pageCount);

  if (page <= 1) {
    return 1;
  }

  return page % 2 === 0 ? page : clampPage(page - 1, pageCount);
};

/**
 * Returns the page numbers that should be visible for the current layout.
 */
export const getVisibleReaderPages = (
  currentPage: number,
  pageCount: number,
  layout: PageLayout
): number[] => {
  const page = clampPage(currentPage, pageCount);

  if (layout === "single" || pageCount < 2) {
    return [page];
  }

  const anchorPage = getSpreadAnchorPage(page, pageCount);

  if (anchorPage <= 1) {
    return [1];
  }

  const nextPage = anchorPage + 1;

  return nextPage <= pageCount ? [anchorPage, nextPage] : [anchorPage];
};

/**
 * Maps a browser keyboard key into a reader command.
 */
export const getReaderKeyboardAction = ({
  key,
  direction,
  shiftKey = false,
  altKey = false,
  ctrlKey = false,
  metaKey = false
}: ReaderShortcutInput): ReaderKeyboardAction | null => {
  if (altKey || ctrlKey || metaKey) {
    return null;
  }

  if (key === "ArrowLeft") {
    return direction === "rtl" ? "next-page" : "previous-page";
  }

  if (key === "ArrowRight") {
    return direction === "rtl" ? "previous-page" : "next-page";
  }

  if (key === "PageDown") {
    return "next-page";
  }

  if (key === "PageUp") {
    return "previous-page";
  }

  if (key === " " || key === "Spacebar") {
    return shiftKey ? "previous-page" : "next-page";
  }

  if (key === "Home") {
    return "first-page";
  }

  if (key === "End") {
    return "last-page";
  }

  if (key === "+" || key === "=") {
    return "zoom-in";
  }

  if (key === "-") {
    return "zoom-out";
  }

  if (key === "0") {
    return "reset-zoom";
  }

  return null;
};

/**
 * Clamps the reader zoom scale into the supported range.
 */
export const clampScale = (scale: number): number => {
  if (!Number.isFinite(scale)) {
    return 1;
  }

  const roundedScale = Math.round(scale * 100) / 100;

  return Math.min(Math.max(roundedScale, 1), 3);
};

/**
 * Builds the API URL for a one-based page image.
 */
export const createPageImageUrl = (
  libraryId: string,
  bookId: string,
  page: number
): string =>
  `/api/libraries/${encodeURIComponent(libraryId)}/books/${encodeURIComponent(bookId)}/pages/${page}/image`;
