import { describe, expect, it } from "vitest";

import { moveCollectionBook } from "./collectionOrder";

describe("collection order", () => {
  it("moves one book without mutating the source order", () => {
    const source = ["a", "b", "c"];

    expect(moveCollectionBook(source, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveCollectionBook(source, "b", 1)).toEqual(["a", "c", "b"]);
    expect(source).toEqual(["a", "b", "c"]);
  });

  it("keeps boundary and unknown items unchanged", () => {
    expect(moveCollectionBook(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveCollectionBook(["a", "b"], "missing", 1)).toEqual(["a", "b"]);
  });
});
