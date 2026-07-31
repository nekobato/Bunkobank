import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appConfigSchema,
  createServerOrigin,
  createServerUrl,
  getDefaultStateDir,
  loadConfig,
  normalizeBindHost,
  resolveStatePaths,
  saveConfig,
  toBrowserHost
} from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("config persistence", () => {
  it("saves and loads app config", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-config-"));
    tempDirs.push(dir);

    const configPath = join(dir, "config.json");
    saveConfig(
      {
        host: "127.0.0.1",
        port: 4510,
        thumbnails: { enabled: false }
      },
      configPath
    );

    expect(loadConfig(configPath).thumbnails.enabled).toBe(false);
  });

  it.each([
    ["setupComplete", false],
    ["setupComplete", true],
    ["dataDir", "/legacy/books"]
  ])("drops the legacy %s field when config is saved again", (key, value) => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-config-"));
    tempDirs.push(dir);

    const configPath = join(dir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        host: "127.0.0.1",
        port: 4510,
        thumbnails: { enabled: true },
        [key]: value
      })
    );

    const loaded = loadConfig(configPath);
    saveConfig(loaded, configPath);

    expect(loaded).not.toHaveProperty("setupComplete");
    expect(loaded).not.toHaveProperty("dataDir");
    expect(JSON.parse(readFileSync(configPath, "utf8"))).not.toHaveProperty(
      key
    );
  });

  it("defaults thumbnail storage to enabled for legacy config files", () => {
    expect(
      appConfigSchema.parse({
        host: "127.0.0.1",
        port: 4510
      }).thumbnails.enabled
    ).toBe(true);
  });

  it("allows only local or LAN bind hosts", () => {
    expect(
      appConfigSchema.parse({
        host: "0.0.0.0",
        port: 4510
      }).host
    ).toBe("0.0.0.0");

    expect(() =>
      appConfigSchema.parse({
        host: "example.com",
        port: 4510
      })
    ).toThrow();
  });

  it("normalizes unsupported bind hosts to local only", () => {
    expect(normalizeBindHost("0.0.0.0")).toBe("0.0.0.0");
    expect(normalizeBindHost("example.com")).toBe("127.0.0.1");
    expect(normalizeBindHost(undefined)).toBe("127.0.0.1");
  });

  it("builds browser URLs from bind host settings", () => {
    const config = {
      host: "0.0.0.0" as const,
      port: 4525,
      thumbnails: { enabled: true }
    };

    expect(toBrowserHost(config.host)).toBe("127.0.0.1");
    expect(createServerOrigin(config)).toBe("http://127.0.0.1:4525");
    expect(createServerUrl(config, "/setup")).toBe(
      "http://127.0.0.1:4525/setup"
    );
  });

  it("uses BOOKCAFE_STATE_DIR before the legacy data directory override", () => {
    expect(
      getDefaultStateDir({
        environment: {
          BOOKCAFE_STATE_DIR: "/new/state",
          BOOKCAFE_DATA_DIR: "/legacy/state"
        },
        homeDirectory: "/Users/bookcafe",
        runtimePlatform: "darwin"
      })
    ).toBe("/new/state");
  });

  it("accepts the legacy override only when the state directory override is absent", () => {
    expect(
      getDefaultStateDir({
        environment: { BOOKCAFE_DATA_DIR: "/legacy/state" },
        homeDirectory: "/Users/bookcafe",
        runtimePlatform: "darwin"
      })
    ).toBe("/legacy/state");
  });

  it.each([
    [
      "darwin" as const,
      {},
      "/Users/bookcafe",
      "/Users/bookcafe/Library/Application Support/BookCafe"
    ],
    [
      "win32" as const,
      { APPDATA: "C:\\Users\\bookcafe\\AppData\\Roaming" },
      "C:\\Users\\bookcafe",
      "C:\\Users\\bookcafe\\AppData\\Roaming/BookCafe"
    ],
    [
      "linux" as const,
      { XDG_DATA_HOME: "/home/bookcafe/.xdg" },
      "/home/bookcafe",
      "/home/bookcafe/.xdg/bookcafe"
    ],
    [
      "linux" as const,
      {},
      "/home/bookcafe",
      "/home/bookcafe/.local/share/bookcafe"
    ]
  ])(
    "resolves the default StateDir for %s",
    (runtimePlatform, environment, homeDirectory, expected) => {
      expect(
        getDefaultStateDir({
          environment,
          homeDirectory,
          runtimePlatform
        })
      ).toBe(expected);
    }
  );

  it("derives all persisted state paths from one StateDir", () => {
    expect(resolveStatePaths("/var/lib/bookcafe")).toEqual({
      root: "/var/lib/bookcafe",
      databasePath: "/var/lib/bookcafe/bookcafe.sqlite",
      thumbnailDir: "/var/lib/bookcafe/thumbnails",
      cacheDir: "/var/lib/bookcafe/cache",
      logDir: "/var/lib/bookcafe/logs"
    });
  });
});
