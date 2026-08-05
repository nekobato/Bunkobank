/**
 * Configuration loading and persistent state path resolution for Bunkobank.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

import { appConfigSchema, type AppConfig } from "./shared.js";

/**
 * Runtime values used to resolve the OS-specific Bunkobank StateDir.
 */
export interface StateDirResolutionOptions {
  environment?: Partial<
    Record<
      | "APPDATA"
      | "BUNKOBANK_DATA_DIR"
      | "BUNKOBANK_STATE_DIR"
      | "XDG_DATA_HOME",
      string
    >
  >;
  homeDirectory?: string;
  runtimePlatform?: NodeJS.Platform;
}

export {
  appConfigSchema,
  bindHostSchema,
  createServerOrigin,
  createServerUrl,
  normalizeBindHost,
  thumbnailSettingsSchema,
  toBrowserHost,
  type AppConfig,
  type BindHost,
  type ThumbnailSettings
} from "./shared.js";

/**
 * Returns the OS-specific directory containing all mutable Bunkobank state.
 */
export const getDefaultStateDir = (
  options: StateDirResolutionOptions = {}
): string => {
  const environment = options.environment ?? process.env;
  const configuredStateDir =
    environment.BUNKOBANK_STATE_DIR?.trim() ||
    environment.BUNKOBANK_DATA_DIR?.trim();

  if (configuredStateDir) {
    return resolve(configuredStateDir);
  }

  const home = options.homeDirectory ?? homedir();
  const runtimePlatform = options.runtimePlatform ?? platform();

  if (runtimePlatform === "darwin") {
    return join(home, "Library", "Application Support", "Bunkobank");
  }

  if (runtimePlatform === "win32") {
    return join(environment.APPDATA ?? home, "Bunkobank");
  }

  return join(
    environment.XDG_DATA_HOME ?? join(home, ".local", "share"),
    "bunkobank"
  );
};

/**
 * Returns the default config file path.
 */
export const getDefaultConfigPath = (): string =>
  resolve(
    process.env.BUNKOBANK_CONFIG ?? join(getDefaultStateDir(), "config.json")
  );

/**
 * Creates the directory for a file path if it does not exist.
 */
export const ensureParentDir = (filePath: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
};

/**
 * Resolves all filesystem paths derived from the Bunkobank StateDir.
 */
export const resolveStatePaths = (stateDir: string) => {
  const root = resolve(stateDir);

  return {
    root,
    databasePath: join(root, "bunkobank.sqlite"),
    thumbnailDir: join(root, "thumbnails"),
    cacheDir: join(root, "cache"),
    logDir: join(root, "logs")
  };
};

/**
 * Compatibility alias for integrations migrating from the former DataDir name.
 *
 * @deprecated Use {@link getDefaultStateDir}.
 */
export const getDefaultDataDir = getDefaultStateDir;

/**
 * Compatibility alias for integrations migrating from the former DataDir name.
 *
 * @deprecated Use {@link resolveStatePaths}.
 */
export const resolveDataPaths = resolveStatePaths;

/**
 * Loads the app config from disk or returns a default config.
 */
export const loadConfig = (configPath = getDefaultConfigPath()): AppConfig => {
  if (!existsSync(configPath)) {
    return appConfigSchema.parse({
      host: "127.0.0.1",
      port: 4510,
      thumbnails: { enabled: true }
    });
  }

  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  return appConfigSchema.parse(raw);
};

/**
 * Saves the app config to disk.
 */
export const saveConfig = (
  config: AppConfig,
  configPath = getDefaultConfigPath()
): AppConfig => {
  const parsed = appConfigSchema.parse(config);
  ensureParentDir(configPath);
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
};
