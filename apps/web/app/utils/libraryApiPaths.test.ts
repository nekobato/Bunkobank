/**
 * Tests for library-scoped API and asset paths.
 *
 * @module
 */

import { describe, expect, it } from "vitest";

import { createLibraryApiPath, resolveApiAssetUrl } from "./libraryApiPaths";

describe("library API paths", () => {
  it("encodes library and book identifiers", () => {
    expect(
      createLibraryApiPath("https://books.test/api", "library/1", [
        "books",
        "book/1"
      ])
    ).toBe("https://books.test/api/libraries/library%2F1/books/book%2F1");
  });

  it("keeps same-origin asset URLs unchanged for a relative API base", () => {
    expect(resolveApiAssetUrl("/api", "/api/libraries/a/thumbnail")).toBe(
      "/api/libraries/a/thumbnail"
    );
  });

  it("moves API asset URLs to the configured absolute server origin", () => {
    expect(
      resolveApiAssetUrl(
        "http://127.0.0.1:4510/api",
        "/api/libraries/a/thumbnail"
      )
    ).toBe("http://127.0.0.1:4510/api/libraries/a/thumbnail");
  });
});
