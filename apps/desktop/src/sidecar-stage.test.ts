/** Portable sidecar staging tests. */

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { materializeSidecarStage } from "../scripts/sidecar-stage.mjs";

const temporaryDirectories: string[] = [];

/** Creates a temporary deploy tree that is removed after each test. */
const createStage = (): string => {
  const stageDir = mkdtempSync(join(tmpdir(), "bookcafe-sidecar-stage-"));
  temporaryDirectories.push(stageDir);
  return stageDir;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("materializeSidecarStage", () => {
  it("flattens unscoped and scoped pnpm package links", () => {
    const stageDir = createStage();
    const nodeModulesDir = join(stageDir, "node_modules");
    const virtualNodeModulesDir = join(nodeModulesDir, ".pnpm", "node_modules");
    const virtualStoreDir = join(nodeModulesDir, ".pnpm");
    const honoPackageDir = join(
      virtualStoreDir,
      "hono@1.0.0",
      "node_modules",
      "hono"
    );
    const configPackageDir = join(
      virtualStoreDir,
      "@bookcafe+config@1.0.0",
      "node_modules",
      "@bookcafe",
      "config"
    );

    mkdirSync(honoPackageDir, { recursive: true });
    mkdirSync(configPackageDir, { recursive: true });
    mkdirSync(join(virtualNodeModulesDir, "@bookcafe"), { recursive: true });
    mkdirSync(join(nodeModulesDir, "@bookcafe"), { recursive: true });
    writeFileSync(
      join(honoPackageDir, "index.js"),
      "export const app = true;\n"
    );
    writeFileSync(
      join(configPackageDir, "index.js"),
      "export const config = true;\n"
    );
    symlinkSync(honoPackageDir, join(virtualNodeModulesDir, "hono"), "dir");
    symlinkSync(
      configPackageDir,
      join(virtualNodeModulesDir, "@bookcafe", "config"),
      "dir"
    );
    symlinkSync(honoPackageDir, join(nodeModulesDir, "hono"), "dir");
    symlinkSync(
      configPackageDir,
      join(nodeModulesDir, "@bookcafe", "config"),
      "dir"
    );

    expect(materializeSidecarStage(stageDir)).toBe(2);
    expect(lstatSync(join(nodeModulesDir, "hono")).isDirectory()).toBe(true);
    expect(
      lstatSync(join(nodeModulesDir, "@bookcafe", "config")).isDirectory()
    ).toBe(true);
    expect(readFileSync(join(nodeModulesDir, "hono", "index.js"), "utf8")).toBe(
      "export const app = true;\n"
    );
    expect(existsSync(join(nodeModulesDir, ".pnpm"))).toBe(false);
  });

  it("rejects a deployment without a pnpm virtual store", () => {
    const stageDir = createStage();

    expect(() => materializeSidecarStage(stageDir)).toThrow(
      "The sidecar staging virtual store is missing"
    );
  });
});
