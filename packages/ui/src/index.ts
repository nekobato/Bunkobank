/** Shared Shelfmark theme primitives for the Bunkobank Vue applications. */

/** Semantic status tones shared by Desktop Manager and Web Library. */
export type ShelfmarkTone =
  "neutral" | "info" | "success" | "warning" | "danger";

/** Element Plus metadata for a Shelfmark status tone. */
export interface ShelfmarkToneMeta {
  type: "info" | "success" | "warning" | "danger";
  className: `tone-${ShelfmarkTone}`;
}

/** Approved signature colors for the Shelfmark visual system. */
export const shelfmarkPalette = {
  deepShelf: "#17353C",
  fog: "#EEF2F2",
  paper: "#F7F9F8",
  inkBlue: "#3159A8",
  spineCoral: "#F26F4F",
  patina: "#75A59B"
} as const;

const shelfmarkToneMetadata: Record<ShelfmarkTone, ShelfmarkToneMeta> = {
  neutral: { type: "info", className: "tone-neutral" },
  info: { type: "info", className: "tone-info" },
  success: { type: "success", className: "tone-success" },
  warning: { type: "warning", className: "tone-warning" },
  danger: { type: "danger", className: "tone-danger" }
};

/** Returns Element Plus type and CSS class metadata for a semantic tone. */
export const getShelfmarkToneMeta = (tone: ShelfmarkTone): ShelfmarkToneMeta =>
  shelfmarkToneMetadata[tone];
