/**
 * Host-target planning tests for the packaged BookCafe server sidecar.
 */

import { describe, expect, it } from "vitest";

import {
  createSidecarDeployPlan,
  createSidecarPackagePlan,
  parseRustHost,
  resolvePkgTarget,
  resolveRustHostArch,
  resolveRustTarget
} from "../scripts/sidecar-plan.mjs";

describe("parseRustHost", () => {
  it("extracts the Rust host target", () => {
    expect(
      parseRustHost("rustc 1.88.0\nbinary: rustc\nhost: aarch64-apple-darwin\n")
    ).toBe("aarch64-apple-darwin");
  });

  it("rejects compiler output without a host", () => {
    expect(() => parseRustHost("rustc 1.88.0\n")).toThrow(
      "rustc -vV did not report a host target."
    );
  });
});

describe("resolveRustTarget", () => {
  const rustVersionOutput =
    "rustc 1.96.1\nbinary: rustc\nhost: aarch64-apple-darwin\n";

  it("uses Tauri's cross-compilation target", () => {
    expect(
      resolveRustTarget({
        rustVersionOutput,
        tauriTargetTriple: "x86_64-apple-darwin"
      })
    ).toBe("x86_64-apple-darwin");
  });

  it("falls back to the Rust compiler host", () => {
    expect(resolveRustTarget({ rustVersionOutput })).toBe(
      "aarch64-apple-darwin"
    );
  });
});

describe("resolvePkgTarget", () => {
  it.each([
    ["darwin", "arm64", "node24-macos-arm64"],
    ["linux", "x64", "node24-linux-x64"],
    ["win32", "x64", "node24-win-x64"]
  ] as const)("maps %s/%s to %s", (platform, arch, expected) => {
    expect(resolvePkgTarget({ platform, arch })).toBe(expected);
  });

  it("rejects unsupported architectures", () => {
    expect(() =>
      resolvePkgTarget({ platform: "linux", arch: "riscv64" })
    ).toThrow("Unsupported sidecar architecture: riscv64");
  });
});

describe("resolveRustHostArch", () => {
  it.each([
    ["aarch64-apple-darwin", "arm64"],
    ["x86_64-pc-windows-msvc", "x64"]
  ])("maps %s to %s", (rustHost, expected) => {
    expect(resolveRustHostArch(rustHost)).toBe(expected);
  });
});

describe("createSidecarPackagePlan", () => {
  it("uses Tauri's Rust target suffix and Enhanced SEA", () => {
    expect(
      createSidecarPackagePlan({
        platform: "darwin",
        arch: "arm64",
        rustHost: "aarch64-apple-darwin",
        serverPackagePath: "/workspace/apps/server/package.json",
        binariesDir: "/workspace/apps/desktop/src-tauri/binaries"
      })
    ).toEqual({
      outputPath:
        "/workspace/apps/desktop/src-tauri/binaries/bookcafe-server-aarch64-apple-darwin",
      pkgArguments: [
        "--sea",
        "--compress",
        "Brotli",
        "--targets",
        "node24-macos-arm64",
        "--output",
        "/workspace/apps/desktop/src-tauri/binaries/bookcafe-server-aarch64-apple-darwin",
        "/workspace/apps/server/package.json"
      ]
    });
  });

  it("creates an Intel macOS sidecar for a cross-compilation target", () => {
    expect(
      createSidecarPackagePlan({
        platform: "darwin",
        arch: "x64",
        rustHost: "x86_64-apple-darwin",
        serverPackagePath: "/workspace/apps/server/package.json",
        binariesDir: "/workspace/apps/desktop/src-tauri/binaries"
      })
    ).toEqual({
      outputPath:
        "/workspace/apps/desktop/src-tauri/binaries/bookcafe-server-x86_64-apple-darwin",
      pkgArguments: [
        "--sea",
        "--compress",
        "Brotli",
        "--targets",
        "node24-macos-x64",
        "--output",
        "/workspace/apps/desktop/src-tauri/binaries/bookcafe-server-x86_64-apple-darwin",
        "/workspace/apps/server/package.json"
      ]
    });
  });

  it("adds the executable suffix for Windows", () => {
    const plan = createSidecarPackagePlan({
      platform: "win32",
      arch: "x64",
      rustHost: "x86_64-pc-windows-msvc",
      serverPackagePath: "C:\\workspace\\apps\\server\\package.json",
      binariesDir: "C:\\workspace\\apps\\desktop\\src-tauri\\binaries"
    });

    expect(plan.outputPath).toMatch(
      /bookcafe-server-x86_64-pc-windows-msvc\.exe$/u
    );
  });

  it("rejects a Node runtime that cannot build the Rust host architecture", () => {
    expect(() =>
      createSidecarPackagePlan({
        platform: "darwin",
        arch: "x64",
        rustHost: "aarch64-apple-darwin",
        serverPackagePath: "/workspace/apps/server/package.json",
        binariesDir: "/workspace/apps/desktop/src-tauri/binaries"
      })
    ).toThrow(
      "Node architecture x64 does not match Rust host aarch64-apple-darwin."
    );
  });
});

describe("createSidecarDeployPlan", () => {
  it("uses an isolated production deployment before SEA materialization", () => {
    expect(
      createSidecarDeployPlan("/workspace/apps/desktop/.sidecar-stage")
    ).toEqual({
      arguments: [
        "--filter",
        "@bookcafe/server",
        "--prod",
        "deploy",
        "--legacy",
        "/workspace/apps/desktop/.sidecar-stage"
      ]
    });
  });
});
