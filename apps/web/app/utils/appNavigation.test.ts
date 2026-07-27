/**
 * Tests for application-shell navigation state.
 *
 * @module
 */

import { describe, expect, it } from "vitest";

import {
  appNavigationItems,
  isAppNavigationItemActive,
  isReaderRoute
} from "./appNavigation";

describe("app navigation", () => {
  it("defines direct routes for every planned primary destination", () => {
    expect(appNavigationItems.map(({ label, to }) => ({ label, to }))).toEqual([
      { label: "ライブラリ", to: "/" },
      { label: "アーカイブ", to: "/archived" },
      { label: "設定", to: "/setup" }
    ]);
  });

  it("selects the archive destination without selecting the library item", () => {
    const libraryItem = appNavigationItems[0];
    const archiveItem = appNavigationItems[1];

    expect(isAppNavigationItemActive(libraryItem, "/archived", "")).toBe(false);
    expect(isAppNavigationItemActive(archiveItem, "/archived", "")).toBe(true);
  });

  it("keeps the library destination active on book detail pages", () => {
    expect(
      isAppNavigationItemActive(appNavigationItems[0], "/books/book-1", "")
    ).toBe(true);
  });

  it("selects setup only within the setup route", () => {
    const setupItem = appNavigationItems[2];

    expect(isAppNavigationItemActive(setupItem, "/setup", "")).toBe(true);
    expect(isAppNavigationItemActive(setupItem, "/login", "")).toBe(false);
  });

  it("recognizes only book reader routes", () => {
    expect(isReaderRoute("/books/book-1/read")).toBe(true);
    expect(isReaderRoute("/books/book-1/read/")).toBe(true);
    expect(isReaderRoute("/books/book-1")).toBe(false);
    expect(isReaderRoute("/setup")).toBe(false);
  });
});
