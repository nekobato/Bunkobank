/**
 * Pure build planning helpers for the packaged BookCafe server sidecar.
 */

import { join } from "node:path";

const pkgPlatformByNodePlatform = Object.freeze({
  darwin: "macos",
  linux: "linux",
  win32: "win"
});

const pkgArchByNodeArch = Object.freeze({
  arm64: "arm64",
  x64: "x64"
});

const pkgArchByRustHostPrefix = Object.freeze({
  aarch64: "arm64",
  x86_64: "x64"
});

/**
 * Reads the Rust host target from `rustc -vV` output.
 *
 * @param {string} output Rust compiler version details.
 * @returns {string} The host target triple.
 */
export const parseRustHost = (output) => {
  const hostLine = output
    .split(/\r?\n/u)
    .find((line) => line.startsWith("host: "));
  const host = hostLine?.slice("host: ".length).trim() ?? "";

  if (!host) {
    throw new Error("rustc -vV did not report a host target.");
  }

  return host;
};

/**
 * Resolves the host-specific `pkg` target used by the Tauri sidecar.
 *
 * @param {{ platform: NodeJS.Platform; arch: string }} environment Host values.
 * @returns {string} A `pkg` target string pinned to Node.js 24.
 */
export const resolvePkgTarget = ({ platform, arch }) => {
  const pkgPlatform = pkgPlatformByNodePlatform[platform];
  const pkgArch = pkgArchByNodeArch[arch];

  if (!pkgPlatform) {
    throw new Error(`Unsupported sidecar platform: ${platform}`);
  }

  if (!pkgArch) {
    throw new Error(`Unsupported sidecar architecture: ${arch}`);
  }

  return `node24-${pkgPlatform}-${pkgArch}`;
};

/**
 * Resolves the package architecture encoded by a Rust host triple.
 *
 * @param {string} rustHost Rust host target triple.
 * @returns {string} The matching `pkg` architecture.
 */
export const resolveRustHostArch = (rustHost) => {
  const rustArchitecture = rustHost.split("-")[0] ?? "";
  const pkgArch = pkgArchByRustHostPrefix[rustArchitecture];

  if (!pkgArch) {
    throw new Error(`Unsupported Rust host architecture: ${rustArchitecture}`);
  }

  return pkgArch;
};

/**
 * Creates the deterministic Enhanced SEA packaging command for one host.
 *
 * @param {{
 *   platform: NodeJS.Platform;
 *   arch: string;
 *   rustHost: string;
 *   serverPackagePath: string;
 *   binariesDir: string;
 * }} options Build inputs.
 * @returns {{ outputPath: string; pkgArguments: string[] }} Packaging plan.
 */
export const createSidecarPackagePlan = ({
  platform,
  arch,
  rustHost,
  serverPackagePath,
  binariesDir
}) => {
  if (!rustHost.trim()) {
    throw new Error("A Rust host target is required.");
  }

  const nodePkgArch = pkgArchByNodeArch[arch];
  const rustPkgArch = resolveRustHostArch(rustHost);

  if (nodePkgArch !== rustPkgArch) {
    throw new Error(
      `Node architecture ${arch} does not match Rust host ${rustHost}.`
    );
  }

  const executableSuffix = platform === "win32" ? ".exe" : "";
  const outputPath = join(
    binariesDir,
    `bookcafe-server-${rustHost}${executableSuffix}`
  );

  return {
    outputPath,
    pkgArguments: [
      "--sea",
      "--compress",
      "Brotli",
      "--targets",
      resolvePkgTarget({ platform, arch: rustPkgArch }),
      "--output",
      outputPath,
      serverPackagePath
    ]
  };
};

/**
 * Creates the pnpm command that stages a portable production server tree.
 *
 * @param {string} stageDir Absolute destination for the generated deployment.
 * @returns {{ arguments: string[] }} The deterministic pnpm deploy plan.
 */
export const createSidecarDeployPlan = (stageDir) => {
  if (!stageDir.trim()) {
    throw new Error("A sidecar staging directory is required.");
  }

  return {
    arguments: [
      "--filter",
      "@bookcafe/server",
      "--prod",
      "deploy",
      "--legacy",
      stageDir
    ]
  };
};
