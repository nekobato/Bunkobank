import type { ReadingStatus } from "@bookcafe/core";

/**
 * Returns a bounded page value while preserving explicit unread/finished state.
 */
export const getBookProgressValue = (
  readingStatus: ReadingStatus,
  currentPage: number,
  pageCount: number
): number => {
  const totalPages = Math.max(Math.trunc(pageCount), 1);

  if (readingStatus === "unread") {
    return 0;
  }

  if (readingStatus === "finished") {
    return totalPages;
  }

  return Math.min(Math.max(Math.trunc(currentPage), 1), totalPages);
};

/**
 * Returns a bounded whole-number percentage for one book's reading state.
 */
export const getBookProgressPercent = (
  readingStatus: ReadingStatus,
  currentPage: number,
  pageCount: number
): number =>
  Math.round(
    (getBookProgressValue(readingStatus, currentPage, pageCount) /
      Math.max(Math.trunc(pageCount), 1)) *
      100
  );
