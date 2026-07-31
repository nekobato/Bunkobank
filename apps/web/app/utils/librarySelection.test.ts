/**
 * Tests for selecting a usable library from persisted user state.
 *
 * @module
 */

import { describe, expect, it } from "vitest";

import { resolveLibrarySelection } from "./librarySelection";

const libraries = [
  {
    id: "library-a",
    name: "漫画",
    rootPath: "/Books/Manga",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z"
  },
  {
    id: "library-b",
    name: "資料",
    rootPath: "/Books/Reference",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z"
  }
] as const;

describe("library selection", () => {
  it("keeps a persisted library that still exists", () => {
    expect(resolveLibrarySelection(libraries, "library-b")).toEqual({
      libraryId: "library-b",
      shouldPersist: false
    });
  });

  it("selects and persists the first library when the preference is stale", () => {
    expect(resolveLibrarySelection(libraries, "deleted-library")).toEqual({
      libraryId: "library-a",
      shouldPersist: true
    });
  });

  it("clears a stale preference when no libraries remain", () => {
    expect(resolveLibrarySelection([], "deleted-library")).toEqual({
      libraryId: null,
      shouldPersist: true
    });
  });

  it("does not rewrite an already empty preference", () => {
    expect(resolveLibrarySelection([], null)).toEqual({
      libraryId: null,
      shouldPersist: false
    });
  });
});
