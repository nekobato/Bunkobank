import { describe, expect, it } from "vitest";

import { getLoginRedirect } from "./authRedirect";

describe("login redirect", () => {
  it("retains a safe internal destination", () => {
    expect(getLoginRedirect("/books/book-1/read?page=2#spread")).toBe(
      "/books/book-1/read?page=2#spread"
    );
  });

  it.each([
    undefined,
    null,
    "https://example.com/",
    "//example.com/",
    "/\\example.com/",
    "/login",
    "/login?redirect=/books"
  ])("falls back to the library for an unsafe destination: %s", (redirect) => {
    expect(getLoginRedirect(redirect)).toBe("/");
  });
});
