import { expect, it } from "vitest";

import { getShelfmarkToneMeta, shelfmarkPalette } from "./index.js";

it("exposes the signature palette and status tone mapping", () => {
  expect(shelfmarkPalette.deepShelf).toBe("#17353C");
  expect(getShelfmarkToneMeta("danger")).toEqual({
    type: "danger",
    className: "tone-danger"
  });
});
