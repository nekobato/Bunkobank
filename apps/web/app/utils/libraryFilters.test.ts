import { describe, expect, it } from "vitest";

import {
  areLibraryFiltersEqual,
  createLibraryQuery,
  formatLibraryResultSummary,
  getRouteBookStatus,
  getRoutePage,
  getRouteReadingStatus,
  getRouteSearch
} from "./libraryFilters";

describe("library filter helpers", () => {
  it("reads route search values from scalar or repeated query fields", () => {
    expect(getRouteSearch("manga")).toBe("manga");
    expect(getRouteSearch(["novel", "ignored"])).toBe("novel");
    expect(getRouteSearch(null)).toBe("");
  });

  it("reads only supported reading status filter values", () => {
    expect(getRouteReadingStatus("reading")).toBe("reading");
    expect(getRouteReadingStatus(["finished"])).toBe("finished");
    expect(getRouteReadingStatus("archived")).toBe("");
  });

  it("reads only supported book status filter values", () => {
    expect(getRouteBookStatus("missing")).toBe("missing");
    expect(getRouteBookStatus(["error"])).toBe("error");
    expect(getRouteBookStatus("archived")).toBe("");
  });

  it("reads only positive one-based page numbers", () => {
    expect(getRoutePage("2")).toBe(2);
    expect(getRoutePage(["3"])).toBe(3);
    expect(getRoutePage("0")).toBe(1);
    expect(getRoutePage("2x")).toBe(1);
    expect(getRoutePage("invalid")).toBe(1);
  });

  it("creates a compact route query from active filters", () => {
    expect(createLibraryQuery("  manga  ", "finished", "missing")).toEqual({
      q: "manga",
      readingStatus: "finished",
      bookStatus: "missing"
    });
    expect(createLibraryQuery("", "", "")).toEqual({});
    expect(createLibraryQuery("manga", "", "", 2)).toEqual({
      q: "manga",
      page: "2"
    });
  });

  it("compares filter states by their normalized route query", () => {
    expect(
      areLibraryFiltersEqual(
        " manga ",
        "unread",
        "missing",
        "manga",
        "unread",
        "missing"
      )
    ).toBe(true);
    expect(
      areLibraryFiltersEqual(
        "manga",
        "unread",
        "missing",
        "manga",
        "finished",
        "missing"
      )
    ).toBe(false);
    expect(
      areLibraryFiltersEqual(
        "manga",
        "unread",
        "missing",
        "manga",
        "unread",
        "ready"
      )
    ).toBe(false);
  });

  it("formats result summaries with active filter labels", () => {
    expect(formatLibraryResultSummary(2, "", "", "")).toBe("蔵書 2冊");
    expect(formatLibraryResultSummary(1, " Origin ", "reading", "ready")).toBe(
      "蔵書 1冊（検索: Origin、読書状況: 読書中、元ファイル: 閲覧可能）"
    );
  });
});
