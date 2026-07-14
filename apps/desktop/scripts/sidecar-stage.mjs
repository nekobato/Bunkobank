/**
 * Portable staging helpers for the packaged BookCafe server sidecar.
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync
} from "node:fs";
import { join } from "node:path";

/**
 * Copies one pnpm-linked package into the flat deployment node_modules tree.
 *
 * @param {string} sourcePath Package link produced by pnpm deploy.
 * @param {string} destinationPath Flat package destination used by SEA.
 * @returns {void}
 */
const materializePackage = (sourcePath, destinationPath) => {
  const packagePath = lstatSync(sourcePath).isSymbolicLink()
    ? realpathSync(sourcePath)
    : sourcePath;

  rmSync(destinationPath, { recursive: true, force: true });
  cpSync(packagePath, destinationPath, {
    recursive: true,
    dereference: true,
    force: true
  });
};

/**
 * Replaces pnpm's virtual-store links with real top-level package directories.
 *
 * Enhanced SEA resolves ESM dependencies from its virtual filesystem and cannot
 * follow pnpm links that point outside the packaged path. A regular `pnpm deploy`
 * remains isolated from the workspace, then this function flattens only the
 * generated staging tree before packaging.
 *
 * @param {string} stageDir Absolute pnpm deployment directory.
 * @returns {number} Number of materialized package directories.
 */
export const materializeSidecarStage = (stageDir) => {
  const nodeModulesDir = join(stageDir, "node_modules");
  const virtualNodeModulesDir = join(nodeModulesDir, ".pnpm", "node_modules");

  if (!existsSync(virtualNodeModulesDir)) {
    throw new Error(
      `The sidecar staging virtual store is missing: ${virtualNodeModulesDir}`
    );
  }

  const packageNames = readdirSync(virtualNodeModulesDir).filter(
    (name) => name !== ".bin"
  );
  let materializedCount = 0;

  for (const packageName of packageNames) {
    const sourcePath = join(virtualNodeModulesDir, packageName);

    if (packageName.startsWith("@")) {
      for (const scopedName of readdirSync(sourcePath)) {
        materializePackage(
          join(sourcePath, scopedName),
          join(nodeModulesDir, packageName, scopedName)
        );
        materializedCount += 1;
      }

      continue;
    }

    materializePackage(sourcePath, join(nodeModulesDir, packageName));
    materializedCount += 1;
  }

  rmSync(join(nodeModulesDir, ".pnpm"), { recursive: true, force: true });

  return materializedCount;
};
