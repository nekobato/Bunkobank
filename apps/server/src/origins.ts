/**
 * Exact local origins trusted by the Hono API and Better Auth.
 */

const defaultClientOrigins = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:1420",
  "http://localhost:1420",
  "tauri://localhost",
  "http://tauri.localhost"
] as const;

/**
 * Builds the deduplicated exact-origin allowlist for Bunkobank clients.
 */
export const getBunkobankClientOrigins = (
  serverOrigins: readonly string[] = [],
  extraOrigins = process.env.BUNKOBANK_TRUSTED_ORIGINS ?? ""
): string[] =>
  Array.from(
    new Set([
      ...defaultClientOrigins,
      ...serverOrigins,
      ...extraOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    ])
  );
