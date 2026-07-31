import { describe, expect, it } from "vitest";

import { normalizeReaderPreferences } from "./readerPreferences";

describe("normalizeReaderPreferences", () => {
  it("keeps every persisted presentation setting except zoom", () => {
    expect(
      normalizeReaderPreferences(
        {
          direction: "ltr",
          mode: "vertical",
          layout: "spread",
          fit: "width",
          scale: 2
        },
        "rtl"
      )
    ).toEqual({
      direction: "ltr",
      mode: "vertical",
      layout: "spread",
      fit: "width"
    });
  });

  it("uses safe defaults for malformed browser storage", () => {
    expect(
      normalizeReaderPreferences(
        {
          direction: "sideways",
          mode: "continuous",
          layout: "triple",
          fit: "cover"
        },
        "rtl"
      )
    ).toEqual({
      direction: "rtl",
      mode: "paged",
      layout: "single",
      fit: "contain"
    });
  });
});
