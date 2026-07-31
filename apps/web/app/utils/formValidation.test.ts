import { describe, expect, it } from "vitest";

import { createFieldErrorMap } from "./formValidation";

describe("createFieldErrorMap", () => {
  it("keeps the first issue for each top-level field", () => {
    expect(
      createFieldErrorMap([
        { path: ["authors", 0], message: "First author error" },
        { path: ["authors", 1], message: "Second author error" },
        { path: [], message: "Form error" }
      ])
    ).toEqual({
      authors: "First author error",
      form: "Form error"
    });
  });
});
