import { expect, it } from "vitest";

import { getLoginRedirect } from "./authRedirect";

it("keeps internal login redirects and rejects external destinations", () => {
  expect(getLoginRedirect("/books/book-1/read?page=2#spread")).toBe(
    "/books/book-1/read?page=2#spread"
  );
  expect(getLoginRedirect("https://example.com/")).toBe("/");
  expect(getLoginRedirect("//example.com/")).toBe("/");
});
