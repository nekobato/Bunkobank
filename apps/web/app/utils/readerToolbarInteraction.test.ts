import { describe, expect, it } from "vitest";

import {
  getReaderHorizontalSide,
  getReaderImageInteraction,
  isPointInReaderTopEdge
} from "./readerToolbarInteraction";

describe("reader toolbar interaction", () => {
  it("splits the complete preview into one left and one right side", () => {
    expect([
      getReaderHorizontalSide({
        pointX: 299,
        previewLeft: 100,
        previewRight: 500
      }),
      getReaderHorizontalSide({
        pointX: 300,
        previewLeft: 100,
        previewRight: 500
      })
    ]).toEqual(["left", "right"]);
  });

  it("uses the measured toolbar height as the image reveal area", () => {
    expect(
      isPointInReaderTopEdge({
        pointY: 179,
        imageTop: 100,
        imageBottom: 900,
        toolbarHeight: 80
      })
    ).toBe(true);
    expect(
      isPointInReaderTopEdge({
        pointY: 181,
        imageTop: 100,
        imageBottom: 900,
        toolbarHeight: 80
      })
    ).toBe(false);
  });

  it("shows the toolbar instead of turning a page at the image top edge", () => {
    expect(
      getReaderImageInteraction({
        isTouchLike: true,
        isToolbarVisible: false,
        isInTopEdge: true
      })
    ).toBe("show-toolbar");
  });

  it("uses the next image tap to dismiss visible touch controls", () => {
    expect(
      getReaderImageInteraction({
        isTouchLike: true,
        isToolbarVisible: true,
        isInTopEdge: false
      })
    ).toBe("hide-toolbar");
  });

  it("navigates outside the toolbar reveal interaction", () => {
    expect(
      getReaderImageInteraction({
        isTouchLike: false,
        isToolbarVisible: false,
        isInTopEdge: false
      })
    ).toBe("navigate");
  });
});
