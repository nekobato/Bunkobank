/**
 * Configuration loading and data path resolution for BookCafe.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

import { appConfigSchema, type AppConfig } from "./shared.js";

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
 * Returns the default OS-specific application data directory.
 */
export const getDefaultDataDir = (): string => {
  if (process.env.BOOKCAFE_DATA_DIR) {
    return resolve(process.env.BOOKCAFE_DATA_DIR);
  }

  const home = homedir();

  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "BookCafe");
  }

  if (platform() === "win32") {
    return join(process.env.APPDATA ?? home, "BookCafe");
  }

  return join(
    process.env.XDG_DATA_HOME ?? join(home, ".local", "share"),
    "bookcafe"
  );
};

/**
 * Returns the default config file path.
 */
export const getDefaultConfigPath = (): string =>
  resolve(
    process.env.BOOKCAFE_CONFIG ?? join(getDefaultDataDir(), "config.json")
  );

/**
 * Creates the directory for a file path if it does not exist.
 */
export const ensureParentDir = (filePath: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
};

/**
 * Resolves all filesystem paths derived from the app data directory.
 */
export const resolveDataPaths = (dataDir: string) => {
  const root = resolve(dataDir);

  return {
    root,
    databasePath: join(root, "bookcafe.sqlite"),
    thumbnailDir: join(root, "thumbnails"),
    logDir: join(root, "logs")
  };
};

/**
 * Loads the app config from disk or returns a default config.
 */
export const loadConfig = (configPath = getDefaultConfigPath()): AppConfig => {
  if (!existsSync(configPath)) {
    return appConfigSchema.parse({
      dataDir: getDefaultDataDir(),
      host: "127.0.0.1",
      port: 4510,
      thumbnails: { enabled: true },
      setupComplete: false
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

/**
 * Returns true when the initial setup has been completed.
 */
export const isSetupComplete = (configPath = getDefaultConfigPath()): boolean =>
  loadConfig(configPath).setupComplete;
