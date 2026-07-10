/**
 * Configuration loading and data path resolution for BookCafe.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

export const bindHostSchema = z.enum(["127.0.0.1", "0.0.0.0"]);

export type BindHost = z.infer<typeof bindHostSchema>;

export const thumbnailSettingsSchema = z
  .object({
    enabled: z.boolean().default(true)
  })
  .default({ enabled: true });

export type ThumbnailSettings = z.infer<typeof thumbnailSettingsSchema>;

export const appConfigSchema = z.object({
  dataDir: z.string().min(1),
  host: bindHostSchema.default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(4510),
  thumbnails: thumbnailSettingsSchema,
  setupComplete: z.boolean().default(false)
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Normalizes user-facing bind host input into a supported server host.
 */
export const normalizeBindHost = (host: unknown): BindHost => {
  const parsed = bindHostSchema.safeParse(host);
  return parsed.success ? parsed.data : "127.0.0.1";
};

/**
 * Converts a bind host into the local browser host used to open the app.
 */
export const toBrowserHost = (host: BindHost): string =>
  host === "0.0.0.0" ? "127.0.0.1" : host;

/**
 * Builds the local origin used by desktop and auth flows to open the web UI.
 */
export const createServerOrigin = (
  config: Pick<AppConfig, "host" | "port">
): string => `http://${toBrowserHost(config.host)}:${config.port}`;

/**
 * Builds a browser URL for a path served by the configured Hono server.
 */
export const createServerUrl = (
  config: Pick<AppConfig, "host" | "port">,
  path = "/"
): string => new URL(path, `${createServerOrigin(config)}/`).toString();

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
