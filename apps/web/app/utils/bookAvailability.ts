import type { BookStatus } from "@bookcafe/core";

/**
 * Returns whether a book source can currently provide reader pages.
 */
export const isReadableBookStatus = (status: BookStatus): boolean =>
  status === "ready";

/**
 * Formats a book source status for compact UI badges.
 */
export const getBookSourceStatusLabel = (status: BookStatus): string => {
  switch (status) {
    case "error":
      return "Error";
    case "missing":
      return "Missing";
    case "scanning":
      return "Scanning";
    default:
      return "Ready";
  }
};

/**
 * Returns the short title for a source availability notice.
 */
export const getBookSourceStatusTitle = (status: BookStatus): string => {
  switch (status) {
    case "error":
      return "Source error";
    case "missing":
      return "Source unavailable";
    case "scanning":
      return "Source scanning";
    default:
      return "Source ready";
  }
};

/**
 * Returns the user-facing remediation text for a source availability state.
 */
export const getBookSourceStatusMessage = (status: BookStatus): string => {
  switch (status) {
    case "error":
      return "This source could not be read. Check the file, then scan the collection root again.";
    case "missing":
      return "Restore the source file, then scan the collection root again.";
    case "scanning":
      return "Reading will be available after the current scan finishes.";
    default:
      return "This source is ready to read.";
  }
};
