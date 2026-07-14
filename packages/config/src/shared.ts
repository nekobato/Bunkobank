/**
 * Runtime-neutral BookCafe configuration schemas and URL helpers.
 */

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
