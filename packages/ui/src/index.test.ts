import { describe, expect, it } from "vitest";

import {
  getShelfmarkToneMeta,
  shelfmarkJapaneseLocale,
  shelfmarkPalette,
  shelfmarkPreset,
  type ShelfmarkTone
} from "./index.js";

describe("Shelfmark design system", () => {
  it("exposes the approved signature palette", () => {
    expect(shelfmarkPalette).toEqual({
      deepShelf: "#17353C",
      fog: "#EEF2F2",
      paper: "#F7F9F8",
      inkBlue: "#3159A8",
      spineCoral: "#F26F4F",
      patina: "#75A59B"
    });
  });

  it("provides complete Japanese calendar labels for PrimeVue", () => {
    expect(shelfmarkJapaneseLocale.dayNames).toHaveLength(7);
    expect(shelfmarkJapaneseLocale.monthNames).toHaveLength(12);
    expect(shelfmarkJapaneseLocale.accept).toBe("適用");
    expect(shelfmarkJapaneseLocale.aria.close).toBe("閉じる");
  });

  it("keeps disabled controls legible without a global opacity reduction", () => {
    expect(
      (shelfmarkPreset.semantic as { disabledOpacity?: string }).disabledOpacity
    ).toBe("1");
  });

  it.each<{
    tone: ShelfmarkTone;
    expected: { severity: string; className: string };
  }>([
    {
      tone: "neutral",
      expected: { severity: "secondary", className: "tone-neutral" }
    },
    {
      tone: "info",
      expected: { severity: "info", className: "tone-info" }
    },
    {
      tone: "success",
      expected: { severity: "success", className: "tone-success" }
    },
    {
      tone: "warning",
      expected: { severity: "warn", className: "tone-warning" }
    },
    {
      tone: "danger",
      expected: { severity: "danger", className: "tone-danger" }
    }
  ])("maps $tone to PrimeVue metadata", ({ tone, expected }) => {
    expect(getShelfmarkToneMeta(tone)).toEqual(expected);
  });
});
