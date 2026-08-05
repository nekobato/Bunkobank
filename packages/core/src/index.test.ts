import { expect, it } from "vitest";

import { createPageImageUrl, getVisibleReaderPages } from "./index.js";

it("keeps reader pagination and page URLs bounded and library-scoped", () => {
  expect(getVisibleReaderPages(3, 12, "spread")).toEqual([2, 3]);
  expect(createPageImageUrl("library/1", "book/1", 3)).toBe(
    "/api/libraries/library%2F1/books/book%2F1/pages/3/image"
  );
});
