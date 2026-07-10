import { describe, expect, it } from "vitest";

import { getApiErrorMessage } from "./apiErrors";

describe("getApiErrorMessage", () => {
  it("prefers server response messages from fetch errors", () => {
    expect(
      getApiErrorMessage(
        {
          data: {
            message: "Collection root must be a readable directory."
          },
          message: '[POST] "/api/collection-roots": 400 Bad Request'
        },
        "Failed"
      )
    ).toBe("Collection root must be a readable directory.");
  });

  it("falls back to Error messages when the response has no message", () => {
    expect(getApiErrorMessage(new Error("Network failed"), "Failed")).toBe(
      "Network failed"
    );
  });

  it("returns the fallback for unknown error shapes", () => {
    expect(getApiErrorMessage({ data: {} }, "Failed")).toBe("Failed");
    expect(getApiErrorMessage(null, "Failed")).toBe("Failed");
  });
});
