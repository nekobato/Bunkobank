import { describe, expect, it } from "vitest";

import {
  clampPage,
  clampScale,
  createPageImageUrl,
  getAdjacentPages,
  getPageByStep,
  getReaderKeyboardAction,
  getSpreadAnchorPage,
  getVisibleReaderPages
} from "./index.js";

describe("reader page helpers", () => {
  it("clamps invalid page numbers into the available range", () => {
    expect(clampPage(0, 12)).toBe(1);
    expect(clampPage(99, 12)).toBe(12);
    expect(clampPage(4.7, 12)).toBe(4);
  });

  it("calculates step navigation with bounds", () => {
    expect(getPageByStep(1, 12, -1)).toBe(1);
    expect(getPageByStep(6, 12, 1)).toBe(7);
    expect(getPageByStep(12, 12, 1)).toBe(12);
  });

  it("returns nearby pages without including the current page", () => {
    expect(getAdjacentPages(6, 12)).toEqual([5, 7]);
    expect(getAdjacentPages(1, 12)).toEqual([2]);
    expect(getAdjacentPages(12, 12)).toEqual([11]);
    expect(getAdjacentPages(6, 12, 2)).toEqual([5, 7, 4, 8]);
  });

  it("clamps zoom scale into the supported reader range", () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(1.236)).toBe(1.24);
    expect(clampScale(4)).toBe(3);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it("anchors spread layout after the cover page", () => {
    expect(getSpreadAnchorPage(1, 12)).toBe(1);
    expect(getSpreadAnchorPage(2, 12)).toBe(2);
    expect(getSpreadAnchorPage(3, 12)).toBe(2);
    expect(getSpreadAnchorPage(12, 12)).toBe(12);
  });

  it("returns visible pages for single and spread layouts", () => {
    expect(getVisibleReaderPages(3, 12, "single")).toEqual([3]);
    expect(getVisibleReaderPages(1, 12, "spread")).toEqual([1]);
    expect(getVisibleReaderPages(2, 12, "spread")).toEqual([2, 3]);
    expect(getVisibleReaderPages(3, 12, "spread")).toEqual([2, 3]);
    expect(getVisibleReaderPages(4, 5, "spread")).toEqual([4, 5]);
    expect(getVisibleReaderPages(4, 4, "spread")).toEqual([4]);
  });

  it("maps arrow shortcuts by reading direction", () => {
    expect(
      getReaderKeyboardAction({ key: "ArrowLeft", direction: "rtl" })
    ).toBe("next-page");
    expect(
      getReaderKeyboardAction({ key: "ArrowRight", direction: "rtl" })
    ).toBe("previous-page");
    expect(
      getReaderKeyboardAction({ key: "ArrowLeft", direction: "ltr" })
    ).toBe("previous-page");
    expect(
      getReaderKeyboardAction({ key: "ArrowRight", direction: "ltr" })
    ).toBe("next-page");
  });

  it("maps paging and jump shortcuts", () => {
    expect(getReaderKeyboardAction({ key: "PageDown", direction: "rtl" })).toBe(
      "next-page"
    );
    expect(getReaderKeyboardAction({ key: "PageUp", direction: "rtl" })).toBe(
      "previous-page"
    );
    expect(getReaderKeyboardAction({ key: "Home", direction: "rtl" })).toBe(
      "first-page"
    );
    expect(getReaderKeyboardAction({ key: "End", direction: "rtl" })).toBe(
      "last-page"
    );
    expect(getReaderKeyboardAction({ key: " ", direction: "rtl" })).toBe(
      "next-page"
    );
    expect(
      getReaderKeyboardAction({
        key: "Spacebar",
        direction: "rtl",
        shiftKey: true
      })
    ).toBe("previous-page");
  });

  it("maps zoom shortcuts", () => {
    expect(getReaderKeyboardAction({ key: "+", direction: "rtl" })).toBe(
      "zoom-in"
    );
    expect(getReaderKeyboardAction({ key: "=", direction: "rtl" })).toBe(
      "zoom-in"
    );
    expect(getReaderKeyboardAction({ key: "-", direction: "rtl" })).toBe(
      "zoom-out"
    );
    expect(getReaderKeyboardAction({ key: "0", direction: "rtl" })).toBe(
      "reset-zoom"
    );
  });

  it("ignores shortcut keys with browser or OS modifiers", () => {
    expect(
      getReaderKeyboardAction({
        key: "ArrowLeft",
        direction: "rtl",
        metaKey: true
      })
    ).toBeNull();
    expect(
      getReaderKeyboardAction({
        key: "+",
        direction: "rtl",
        ctrlKey: true
      })
    ).toBeNull();
    expect(
      getReaderKeyboardAction({
        key: "PageDown",
        direction: "rtl",
        altKey: true
      })
    ).toBeNull();
  });

  it("builds a library-scoped page image URL", () => {
    expect(createPageImageUrl("library/1", "book/1", 3)).toBe(
      "/api/libraries/library%2F1/books/book%2F1/pages/3/image"
    );
  });
});
