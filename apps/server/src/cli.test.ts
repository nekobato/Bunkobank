import { describe, expect, it } from "vitest";

import { parseServerCliOptions } from "./cli.js";

describe("server CLI options", () => {
  it("parses a config path from separated arguments", () => {
    expect(
      parseServerCliOptions([
        "--config",
        "/Users/alice/Library/Application Support/BookCafe/config.json"
      ])
    ).toEqual({
      configPath:
        "/Users/alice/Library/Application Support/BookCafe/config.json"
    });
  });

  it("parses a config path from an equals argument", () => {
    expect(
      parseServerCliOptions([
        "--config=/Users/alice/Library/Application Support/BookCafe/config.json"
      ])
    ).toEqual({
      configPath:
        "/Users/alice/Library/Application Support/BookCafe/config.json"
    });
  });

  it("rejects a config flag without a path", () => {
    expect(() => parseServerCliOptions(["--config"])).toThrow(
      "--config requires a path."
    );
    expect(() => parseServerCliOptions(["--config="])).toThrow(
      "--config requires a path."
    );
  });
});
