import type { BookStatus, ReadingStatus } from "@bookcafe/core";

export type ReadingStatusFilter = "" | ReadingStatus;
export type BookStatusFilter = "" | BookStatus;

export interface ReadingStatusFilterOption {
  value: ReadingStatusFilter;
  label: string;
}

export interface BookStatusFilterOption {
  value: BookStatusFilter;
  label: string;
}

export const readingStatusFilterOptions: ReadingStatusFilterOption[] = [
  { value: "", label: "すべて" },
  { value: "unread", label: "未読" },
  { value: "reading", label: "読書中" },
  { value: "finished", label: "読了" }
];

export const bookStatusFilterOptions: BookStatusFilterOption[] = [
  { value: "", label: "すべて" },
  { value: "ready", label: "閲覧可能" },
  { value: "missing", label: "見つかりません" },
  { value: "error", label: "エラー" },
  { value: "scanning", label: "スキャン中" }
];

/**
 * Formats the current library result count and active filters.
 */
export const formatLibraryResultSummary = (
  bookCount: number,
  searchText: string,
  readingStatus: ReadingStatusFilter,
  bookStatus: BookStatusFilter
): string => {
  const countLabel = `蔵書 ${bookCount}冊`;
  const filterLabels = getActiveLibraryFilterLabels(
    searchText,
    readingStatus,
    bookStatus
  );

  if (filterLabels.length < 1) {
    return countLabel;
  }

  return `${countLabel}（${filterLabels.join("、")}）`;
};

/**
 * Reads a single string value from a route query field.
 */
export const getRouteSearch = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return "";
};

/**
 * Reads a valid reading status filter from a route query field.
 */
export const getRouteReadingStatus = (value: unknown): ReadingStatusFilter => {
  const status = getRouteSearch(value);

  return isReadingStatusFilter(status) ? status : "";
};

/**
 * Reads a valid book source status filter from a route query field.
 */
export const getRouteBookStatus = (value: unknown): BookStatusFilter => {
  const status = getRouteSearch(value);

  return isBookStatusFilter(status) ? status : "";
};

/**
 * Creates the route query for the library filters.
 */
export const createLibraryQuery = (
  searchText: string,
  readingStatus: ReadingStatusFilter,
  bookStatus: BookStatusFilter
): Record<string, string> => {
  const query = searchText.trim();

  return {
    ...(query.length > 0 ? { q: query } : {}),
    ...(readingStatus.length > 0 ? { readingStatus } : {}),
    ...(bookStatus.length > 0 ? { bookStatus } : {})
  };
};

/**
 * Returns true when two filter states produce the same route query.
 */
export const areLibraryFiltersEqual = (
  leftSearchText: string,
  leftReadingStatus: ReadingStatusFilter,
  leftBookStatus: BookStatusFilter,
  rightSearchText: string,
  rightReadingStatus: ReadingStatusFilter,
  rightBookStatus: BookStatusFilter
): boolean => {
  const leftQuery = createLibraryQuery(
    leftSearchText,
    leftReadingStatus,
    leftBookStatus
  );
  const rightQuery = createLibraryQuery(
    rightSearchText,
    rightReadingStatus,
    rightBookStatus
  );

  return (
    leftQuery.q === rightQuery.q &&
    leftQuery.readingStatus === rightQuery.readingStatus &&
    leftQuery.bookStatus === rightQuery.bookStatus
  );
};

/**
 * Builds human-readable labels for active library filters.
 */
const getActiveLibraryFilterLabels = (
  searchText: string,
  readingStatus: ReadingStatusFilter,
  bookStatus: BookStatusFilter
): string[] => {
  const query = searchText.trim();

  return [
    ...(query.length > 0 ? [`検索: ${query}`] : []),
    ...getOptionLabel("読書状況: ", readingStatus, readingStatusFilterOptions),
    ...getOptionLabel("元ファイル: ", bookStatus, bookStatusFilterOptions)
  ];
};

/**
 * Returns a formatted option label for one active filter value.
 */
const getOptionLabel = <T extends string>(
  prefix: string,
  value: T,
  options: { value: T; label: string }[]
): string[] => {
  if (value.length < 1) {
    return [];
  }

  const option = options.find((candidate) => candidate.value === value);

  return option ? [`${prefix}${option.label}`] : [];
};

/**
 * Narrows arbitrary strings to a concrete reading status filter.
 */
const isReadingStatusFilter = (value: string): value is ReadingStatusFilter =>
  value === "" ||
  value === "unread" ||
  value === "reading" ||
  value === "finished";

/**
 * Narrows arbitrary strings to a concrete book status filter.
 */
const isBookStatusFilter = (value: string): value is BookStatusFilter =>
  value === "" ||
  value === "ready" ||
  value === "missing" ||
  value === "error" ||
  value === "scanning";
