export type ReaderImageInteraction =
  "navigate" | "show-toolbar" | "hide-toolbar";

type ReaderTopEdge = {
  pointY: number;
  imageTop: number;
  imageBottom: number;
  toolbarHeight: number;
};

type ReaderHorizontalSideInput = {
  pointX: number;
  previewLeft: number;
  previewRight: number;
};

type ReaderImageInteractionInput = {
  isTouchLike: boolean;
  isToolbarVisible: boolean;
  isInTopEdge: boolean;
};

/**
 * Returns the physical side of the complete page preview containing a point.
 */
export const getReaderHorizontalSide = ({
  pointX,
  previewLeft,
  previewRight
}: ReaderHorizontalSideInput): "left" | "right" =>
  pointX < previewLeft + (previewRight - previewLeft) / 2 ? "left" : "right";

/**
 * Returns whether a vertical pointer coordinate is inside the image's toolbar
 * reveal area.
 */
export const isPointInReaderTopEdge = ({
  pointY,
  imageTop,
  imageBottom,
  toolbarHeight
}: ReaderTopEdge): boolean =>
  pointY >= imageTop &&
  pointY <= Math.min(imageBottom, imageTop + Math.max(0, toolbarHeight));

/**
 * Resolves whether an image click controls the toolbar or turns the page.
 */
export const getReaderImageInteraction = ({
  isTouchLike,
  isToolbarVisible,
  isInTopEdge
}: ReaderImageInteractionInput): ReaderImageInteraction => {
  if (isTouchLike && isToolbarVisible) {
    return "hide-toolbar";
  }

  if (isInTopEdge) {
    return "show-toolbar";
  }

  return "navigate";
};
