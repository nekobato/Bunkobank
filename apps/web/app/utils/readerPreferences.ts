/**
 * Runtime-safe reader presentation preferences stored in the browser.
 *
 * @module
 */

import type { PageLayout, ReadingDirection } from "@bunkobank/core";

export interface ReaderPreferences {
  direction: ReadingDirection;
  mode: "paged" | "vertical";
  layout: PageLayout;
  fit: "contain" | "width" | "height" | "actual";
}

/**
 * Returns reader preferences after discarding unsupported stored values.
 */
export const normalizeReaderPreferences = (
  value: unknown,
  defaultDirection: ReadingDirection
): ReaderPreferences => {
  const stored = isRecord(value) ? value : {};

  return {
    direction:
      stored.direction === "rtl" || stored.direction === "ltr"
        ? stored.direction
        : defaultDirection,
    mode:
      stored.mode === "paged" || stored.mode === "vertical"
        ? stored.mode
        : "paged",
    layout:
      stored.layout === "single" || stored.layout === "spread"
        ? stored.layout
        : "single",
    fit:
      stored.fit === "contain" ||
      stored.fit === "width" ||
      stored.fit === "height" ||
      stored.fit === "actual"
        ? stored.fit
        : "contain"
  };
};

/**
 * Narrows arbitrary values to indexable records.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
