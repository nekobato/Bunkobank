/**
 * Cross-file configuration tests for the packaged Tauri server sidecar.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  bin?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  main?: string;
  pkg?: { assets?: string[] };
  scripts?: Record<string, string>;
}

interface TauriConfiguration {
  identifier: string;
  build: { beforeBuildCommand?: string };
  bundle: {
    externalBin?: string[];
    icon?: string[];
    macOS?: { minimumSystemVersion?: string; signingIdentity?: string };
  };
}

interface TauriCapability {
  permissions: Array<
    | string
    | {
        identifier: string;
        allow?: Array<{
          name: string;
          sidecar: boolean;
          args: unknown[];
        }>;
      }
  >;
}

/** Reads and parses one JSON file relative to this test module. */
const readJson = <Value>(path: string): Value =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Value;

describe("sidecar package configuration", () => {
  it("builds the desktop manager with Vue", () => {
    const desktopPackage = readJson<PackageManifest>("../package.json");

    expect(desktopPackage.dependencies?.vue).toMatch(/^\^3\./);
    expect(
      desktopPackage.devDependencies?.["@vitejs/plugin-vue"]
    ).toBeDefined();
    expect(desktopPackage.devDependencies?.["vue-tsc"]).toBeDefined();
    expect(desktopPackage.scripts?.typecheck).toContain("vue-tsc");
  });

  it("packages the built server and generated web application", () => {
    const serverPackage = readJson<PackageManifest>(
      "../../server/package.json"
    );

    expect(serverPackage.bin).toBe("dist/main.js");
    expect(serverPackage.pkg?.assets).toEqual(
      expect.arrayContaining([
        "public/**/*",
        "node_modules/better-sqlite3/build/Release/*.node",
        "node_modules/hono/dist/**/*.js",
        "node_modules/@hono/node-server/dist/**/*",
        "node_modules/@img/sharp-*/**/*",
        "node_modules/@napi-rs/canvas-*/**/*",
        "node_modules/@better-auth/utils/dist/**/*",
        "node_modules/better-call/dist/**/*",
        "node_modules/libarchive-wasm/dist/libarchive.wasm",
        "node_modules/pdfjs-dist/cmaps/**/*",
        "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
        "node_modules/pdfjs-dist/standard_fonts/**/*",
        "node_modules/pdfjs-dist/wasm/**/*"
      ])
    );
  });

  it("pins sidecar packaging to the Node.js 24 native ABI", () => {
    const rootPackage = readJson<PackageManifest>("../../../package.json");
    const buildScript = readFileSync(
      new URL("../scripts/build-sidecar.mjs", import.meta.url),
      "utf8"
    );

    expect(rootPackage.engines?.node).toBe("24.x");
    expect(buildScript).toContain("nodeMajor !== 24");
  });

  it("exposes a standard main entry for every packaged workspace dependency", () => {
    const packagePaths = [
      "../../../packages/config/package.json",
      "../../../packages/contracts/package.json",
      "../../../packages/core/package.json",
      "../../../packages/db/package.json",
      "../../../packages/format-adapters/package.json",
      "../../../packages/scanner/package.json"
    ];

    expect(
      packagePaths.map((path) => readJson<PackageManifest>(path).main)
    ).toEqual([
      "./dist/index.js",
      "./dist/index.js",
      "./dist/index.js",
      "./dist/library.js",
      "./dist/index.js",
      "./dist/index.js"
    ]);
  });

  it("keeps bundle, build command, and shell capability names aligned", () => {
    const desktopPackage = readJson<PackageManifest>("../package.json");
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

    expect(desktopPackage.scripts?.["sidecar:build"]).toContain(
      "build-sidecar.mjs"
    );
    expect(desktopPackage.scripts?.["notarize:build"]).toBe(
      "zsh scripts/notarize-build.zsh"
    );
    expect(tauriConfig.build.beforeBuildCommand).toContain("sidecar:build");
    expect(tauriConfig.bundle.externalBin).toEqual([
      "binaries/bookcafe-server"
    ]);
    expect(tauriConfig.identifier).toBe("dev.bookcafe.desktop");
    expect(tauriConfig.bundle.icon).toEqual(
      expect.arrayContaining(["icons/icon.icns", "icons/icon.ico"])
    );
    expect(tauriConfig.bundle.macOS?.minimumSystemVersion).toBe("13.0");
    expect(tauriConfig.bundle.macOS?.signingIdentity).toBe(
      "Developer ID Application: Hayato Koriyama (N5BWSDK26P)"
    );
    expect(spawnPermission).toMatchObject({
      allow: [
        {
          name: "binaries/bookcafe-server",
          sidecar: true,
          args: ["--config", { validator: ".+" }]
        }
      ]
    });
  });
});
