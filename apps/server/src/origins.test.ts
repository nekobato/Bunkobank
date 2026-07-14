/**
 * Tests for local browser and Tauri client origin allowlisting.
 */

import { describe, expect, it } from "vitest";

import { getBookCafeClientOrigins } from "./origins.js";

describe("getBookCafeClientOrigins", () => {
  it("includes exact Nuxt and Tauri development and production origins", () => {
    expect(getBookCafeClientOrigins()).toEqual([
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://127.0.0.1:1420",
      "http://localhost:1420",
      "tauri://localhost",
      "http://tauri.localhost"
    ]);
  });

  it("trims and deduplicates server and environment origins", () => {
    expect(
      getBookCafeClientOrigins(
        ["http://127.0.0.1:4510"],
        " https://manager.example.test, http://127.0.0.1:4510 "
      )
    ).toContain("https://manager.example.test");
    expect(
      getBookCafeClientOrigins(
        ["http://127.0.0.1:4510"],
        "https://manager.example.test,http://127.0.0.1:4510"
      ).filter((origin) => origin === "http://127.0.0.1:4510")
    ).toHaveLength(1);
  });
});
