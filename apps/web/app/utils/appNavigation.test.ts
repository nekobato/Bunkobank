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
      { label: "Library", to: "/" },
      { label: "Collections", to: "/#collections" },
      { label: "Jobs", to: "/#jobs" },
      { label: "Setup", to: "/setup" }
    ]);
  });

  it("selects hash destinations without selecting the library item", () => {
    const libraryItem = appNavigationItems[0];
    const collectionsItem = appNavigationItems[1];

    expect(isAppNavigationItemActive(libraryItem, "/", "#collections")).toBe(
      false
    );
    expect(
      isAppNavigationItemActive(collectionsItem, "/", "#collections")
    ).toBe(true);
  });

  it("keeps the library destination active on book detail pages", () => {
    expect(
      isAppNavigationItemActive(appNavigationItems[0], "/books/book-1", "")
    ).toBe(true);
  });

  it("selects setup only within the setup route", () => {
    const setupItem = appNavigationItems[3];

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
