/**
 * Packages the built Hono server as a target-specific Enhanced SEA sidecar.
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
  resolveRustHostArch,
  resolveRustTarget
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
const workspaceMetadataPaths = [
  join(workspaceDir, "node_modules/.modules.yaml"),
  join(workspaceDir, "node_modules/.pnpm-workspace-state-v1.json")
];
const pkgPackagePath = require.resolve("@yao-pkg/pkg/package.json");
const pkgManifest = JSON.parse(readFileSync(pkgPackagePath, "utf8"));
const pkgCliPath = join(dirname(pkgPackagePath), pkgManifest.bin.pkg);
const rustVersionOutput = execFileSync("rustc", ["-vV"], {
  encoding: "utf8",
  timeout: 30_000
});
const rustTarget = resolveRustTarget({
  rustVersionOutput,
  tauriTargetTriple: process.env.TAURI_ENV_TARGET_TRIPLE
});
const targetArch = resolveRustHostArch(rustTarget);

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
  const deployPlan = createSidecarDeployPlan(stageDir, {
    platform: process.platform,
    arch: targetArch
  });
  console.log(`Staging portable Bunkobank server at ${stageDir}`);
  const workspaceMetadata = workspaceMetadataPaths.map((path) => ({
    path,
    contents: existsSync(path) ? readFileSync(path) : undefined
  }));

  try {
    execFileSync("pnpm", deployPlan.arguments, {
      cwd: workspaceDir,
      stdio: "inherit",
      timeout: 5 * 60_000
    });
  } finally {
    for (const metadata of workspaceMetadata) {
      if (metadata.contents) {
        writeFileSync(metadata.path, metadata.contents);
      } else {
        rmSync(metadata.path, { force: true });
      }
    }
  }

  console.log(`Preparing better-sqlite3 for ${process.platform}-${targetArch}`);
  execFileSync(
    "pnpm",
    ["--dir", join(stageDir, "node_modules/better-sqlite3"), "run", "install"],
    {
      cwd: workspaceDir,
      env: {
        ...process.env,
        npm_config_arch: targetArch,
        npm_config_platform: process.platform
      },
      stdio: "inherit",
      timeout: 5 * 60_000
    }
  );

  const materializedPackageCount = materializeSidecarStage(stageDir);
  console.log(
    `Materialized ${materializedPackageCount.toLocaleString("en-US")} staged packages for SEA resolution.`
  );

  const plan = createSidecarPackagePlan({
    platform: process.platform,
    arch: targetArch,
    rustHost: rustTarget,
    serverPackagePath: stagePackagePath,
    binariesDir
  });

  mkdirSync(binariesDir, { recursive: true });
  console.log(`Packaging Bunkobank sidecar at ${plan.outputPath}`);
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
    `Packaged Bunkobank sidecar (${sidecarStat.size.toLocaleString("en-US")} bytes).`
  );
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
