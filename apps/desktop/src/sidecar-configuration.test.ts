import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { createBunkobankServerLaunchAgent } from "./index.js";

interface TauriConfiguration {
  identifier: string;
  bundle: { externalBin?: string[] };
}

interface TauriCapability {
  permissions: Array<
    | string
    | {
        identifier: string;
        allow?: Array<{ name?: string; sidecar?: boolean }>;
      }
  >;
}

const readJson = <Value>(path: string): Value =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Value;

it("keeps the Tauri identifier, sidecar, and capability aligned", () => {
  const tauriConfig = readJson<TauriConfiguration>(
    "../src-tauri/tauri.conf.json"
  );
  const capability = readJson<TauriCapability>(
    "../src-tauri/capabilities/default.json"
  );
  const spawnPermission = capability.permissions.find(
    (permission) =>
      typeof permission !== "string" &&
      permission.identifier === "shell:allow-spawn"
  );

  expect(tauriConfig.identifier).toBe("app.nekobato.bunkobank");
  expect(tauriConfig.bundle.externalBin).toEqual(["binaries/bunkobank-server"]);
  expect(
    createBunkobankServerLaunchAgent({ serverCommand: "/bin/bunkobank-server" })
      .label
  ).toBe("app.nekobato.bunkobank.server");
  expect(spawnPermission).toMatchObject({
    allow: [{ name: "binaries/bunkobank-server", sidecar: true }]
  });
});
