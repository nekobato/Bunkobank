import type { BookSort, SortOrder } from "@bunkobank/contracts";
import type { BookStatus, ReadingStatus } from "@bunkobank/core";

export type ReadingStatusFilter = "" | ReadingStatus;
export type BookStatusFilter = "" | BookStatus;
export const BOOK_LIST_PAGE_SIZE = 100;

export interface ReadingStatusFilterOption {
  value: ReadingStatusFilter;
  label: string;
}

export interface BookStatusFilterOption {
  value: BookStatusFilter;
  label: string;
}

export interface BookSortOption {
  value: BookSort;
  label: string;
}

export interface SortOrderOption {
  value: SortOrder;
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

export const bookSortOptions: BookSortOption[] = [
  { value: "title", label: "タイトル" },
  { value: "purchasedAt", label: "購入日" },
  { value: "updatedAt", label: "更新日" },
  { value: "lastReadAt", label: "最後に読んだ日" }
];

export const sortOrderOptions: SortOrderOption[] = [
  { value: "asc", label: "昇順" },
  { value: "desc", label: "降順" }
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
 * Reads a supported database-backed sort field from the route.
 */
export const getRouteBookSort = (value: unknown): BookSort => {
  const sort = getRouteSearch(value);

  return sort === "purchasedAt" || sort === "updatedAt" || sort === "lastReadAt"
    ? sort
    : "title";
};

/**
 * Reads a supported sort direction from the route.
 */
export const getRouteSortOrder = (value: unknown): SortOrder =>
  getRouteSearch(value) === "desc" ? "desc" : "asc";

/**
 * Reads a positive one-based page number from a route query field.
 */
export const getRoutePage = (value: unknown): number => {
  const rawPage = getRouteSearch(value);
  const page = /^\d+$/u.test(rawPage) ? Number(rawPage) : Number.NaN;

  return Number.isSafeInteger(page) && page > 0 ? page : 1;
};

/**
 * Creates the route query for the library filters.
 */
export const createLibraryQuery = (
  searchText: string,
  readingStatus: ReadingStatusFilter,
  bookStatus: BookStatusFilter,
  page = 1,
  sort: BookSort = "title",
  order: SortOrder = "asc"
): Record<string, string> => {
  const query = searchText.trim();

  return {
    ...(query.length > 0 ? { q: query } : {}),
    ...(readingStatus.length > 0 ? { readingStatus } : {}),
    ...(bookStatus.length > 0 ? { bookStatus } : {}),
    ...(sort !== "title" ? { sort } : {}),
    ...(order !== "asc" ? { order } : {}),
    ...(page > 1 ? { page: String(page) } : {})
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
  rightBookStatus: BookStatusFilter,
  leftSort: BookSort = "title",
  leftOrder: SortOrder = "asc",
  rightSort: BookSort = "title",
  rightOrder: SortOrder = "asc"
): boolean => {
  const leftQuery = createLibraryQuery(
    leftSearchText,
    leftReadingStatus,
    leftBookStatus,
    1,
    leftSort,
    leftOrder
  );
  const rightQuery = createLibraryQuery(
    rightSearchText,
    rightReadingStatus,
    rightBookStatus,
    1,
    rightSort,
    rightOrder
  );

  return (
    leftQuery.q === rightQuery.q &&
    leftQuery.readingStatus === rightQuery.readingStatus &&
    leftQuery.bookStatus === rightQuery.bookStatus &&
    leftQuery.sort === rightQuery.sort &&
    leftQuery.order === rightQuery.order
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
