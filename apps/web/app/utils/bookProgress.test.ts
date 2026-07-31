import { describe, expect, it } from "vitest";

import { getBookProgressPercent, getBookProgressValue } from "./bookProgress";

describe("book progress", () => {
  it("uses explicit reading state at the progress boundaries", () => {
    expect(getBookProgressValue("unread", 1, 1)).toBe(0);
    expect(getBookProgressPercent("unread", 1, 1)).toBe(0);
    expect(getBookProgressPercent("finished", 1, 100)).toBe(100);
  });

  it("converts one-based reading pages into a bounded percentage", () => {
    expect(getBookProgressPercent("reading", 25, 100)).toBe(25);
    expect(getBookProgressPercent("reading", 200, 100)).toBe(100);
    expect(getBookProgressPercent("reading", 0, 0)).toBe(100);
  });
});
