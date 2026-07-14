/**
 * Packages the built Hono server as a host-native Enhanced SEA sidecar.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  createSidecarDeployPlan,
  createSidecarPackagePlan,
  parseRustHost
} from "./sidecar-plan.mjs";
import { materializeSidecarStage } from "./sidecar-stage.mjs";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = dirname(scriptDir);
const workspaceDir = dirname(dirname(desktopDir));
const serverEntryPath = join(workspaceDir, "apps/server/dist/main.js");
const serverWebEntryPath = join(workspaceDir, "apps/server/public/200.html");
const binariesDir = join(desktopDir, "src-tauri/binaries");
const stageDir = join(desktopDir, ".sidecar-stage");
const stagePackagePath = join(stageDir, "package.json");
const workspaceStatePath = join(
  workspaceDir,
  "node_modules/.pnpm-workspace-state-v1.json"
);
const pkgPackagePath = require.resolve("@yao-pkg/pkg/package.json");
const pkgManifest = JSON.parse(readFileSync(pkgPackagePath, "utf8"));
const pkgCliPath = join(dirname(pkgPackagePath), pkgManifest.bin.pkg);

/** Ensures build prerequisites exist before starting the expensive package step. */
const assertPrerequisites = () => {
  const missingPaths = [serverEntryPath, serverWebEntryPath].filter(
    (path) => !existsSync(path)
  );

  if (missingPaths.length > 0) {
    throw new Error(
      `Sidecar prerequisites are missing: ${missingPaths.join(", ")}. Run sidecar:prepare first.`
    );
  }

  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "",
    10
  );

  if (nodeMajor !== 24) {
    throw new Error("Enhanced SEA packaging requires Node.js 24.x.");
  }
};

assertPrerequisites();

rmSync(stageDir, { recursive: true, force: true });

try {
  const deployPlan = createSidecarDeployPlan(stageDir);
  console.log(`Staging portable BookCafe server at ${stageDir}`);
  const workspaceState = existsSync(workspaceStatePath)
    ? readFileSync(workspaceStatePath)
    : undefined;

  try {
    execFileSync("pnpm", deployPlan.arguments, {
      cwd: workspaceDir,
      stdio: "inherit",
      timeout: 5 * 60_000
    });
  } finally {
    if (workspaceState) {
      writeFileSync(workspaceStatePath, workspaceState);
    } else {
      rmSync(workspaceStatePath, { force: true });
    }
  }

  const materializedPackageCount = materializeSidecarStage(stageDir);
  console.log(
    `Materialized ${materializedPackageCount.toLocaleString("en-US")} staged packages for SEA resolution.`
  );

  const rustVersionOutput = execFileSync("rustc", ["-vV"], {
    encoding: "utf8",
    timeout: 30_000
  });
  const plan = createSidecarPackagePlan({
    platform: process.platform,
    arch: process.arch,
    rustHost: parseRustHost(rustVersionOutput),
    serverPackagePath: stagePackagePath,
    binariesDir
  });

  mkdirSync(binariesDir, { recursive: true });
  console.log(`Packaging BookCafe sidecar at ${plan.outputPath}`);
  execFileSync(process.execPath, [pkgCliPath, ...plan.pkgArguments], {
    cwd: workspaceDir,
    stdio: "inherit",
    timeout: 15 * 60_000
  });

  const sidecarStat = statSync(plan.outputPath);

  if (!sidecarStat.isFile() || sidecarStat.size === 0) {
    throw new Error(
      `Packaged sidecar is not a readable file: ${plan.outputPath}`
    );
  }

  console.log(
    `Packaged BookCafe sidecar (${sidecarStat.size.toLocaleString("en-US")} bytes).`
  );
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
