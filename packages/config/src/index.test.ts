import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  getDefaultStateDir,
  loadConfig,
  resolveStatePaths,
  saveConfig
} from "./index.js";

it("persists configuration and resolves Bunkobank state paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "bunkobank-config-"));
  const configPath = join(directory, "config.json");
  const config = {
    host: "127.0.0.1" as const,
    port: 4510,
    thumbnails: { enabled: false }
  };

  try {
    saveConfig(config, configPath);

    expect(loadConfig(configPath)).toEqual(config);
    expect(
      getDefaultStateDir({
        environment: {},
        homeDirectory: "/Users/bunkobank",
        runtimePlatform: "darwin"
      })
    ).toBe("/Users/bunkobank/Library/Application Support/Bunkobank");
    expect(resolveStatePaths("/var/lib/bunkobank").databasePath).toBe(
      "/var/lib/bunkobank/bunkobank.sqlite"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
