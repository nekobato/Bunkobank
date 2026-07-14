import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appConfigSchema,
  createServerOrigin,
  createServerUrl,
  loadConfig,
  normalizeBindHost,
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
        dataDir: dir,
        host: "127.0.0.1",
        port: 4510,
        thumbnails: { enabled: false },
        setupComplete: true
      },
      configPath
    );

    expect(loadConfig(configPath).setupComplete).toBe(true);
    expect(loadConfig(configPath).thumbnails.enabled).toBe(false);
  });

  it("defaults thumbnail storage to enabled for legacy config files", () => {
    expect(
      appConfigSchema.parse({
        dataDir: "/tmp/bookcafe",
        host: "127.0.0.1",
        port: 4510,
        setupComplete: false
      }).thumbnails.enabled
    ).toBe(true);
  });

  it("allows only local or LAN bind hosts", () => {
    expect(
      appConfigSchema.parse({
        dataDir: "/tmp/bookcafe",
        host: "0.0.0.0",
        port: 4510,
        setupComplete: false
      }).host
    ).toBe("0.0.0.0");

    expect(() =>
      appConfigSchema.parse({
        dataDir: "/tmp/bookcafe",
        host: "example.com",
        port: 4510,
        setupComplete: false
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
      dataDir: "/tmp/bookcafe",
      host: "0.0.0.0" as const,
      port: 4525,
      thumbnails: { enabled: true },
      setupComplete: true
    };

    expect(toBrowserHost(config.host)).toBe("127.0.0.1");
    expect(createServerOrigin(config)).toBe("http://127.0.0.1:4525");
    expect(createServerUrl(config, "/setup")).toBe(
      "http://127.0.0.1:4525/setup"
    );
  });
});
