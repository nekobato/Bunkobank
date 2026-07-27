/**
 * Better Auth setup for the Hono server.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createServerOrigin, type BindHost } from "@bookcafe/config";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins";

import { getBookCafeClientOrigins } from "./origins.js";

interface CachedAuth {
  cacheKey: string;
  auth: ReturnType<typeof createAuth>;
}

export interface AuthOptions {
  databasePath: string;
  host: BindHost;
  port: number;
}

let cachedAuth: CachedAuth | null = null;

/**
 * Creates a Better Auth instance backed by the shared BookCafe SQLite file.
 */
export const createAuth = (options: AuthOptions) => {
  const databasePath = resolve(options.databasePath);
  const baseURL = getAuthBaseURL(options);
  mkdirSync(dirname(databasePath), { recursive: true });

  return betterAuth({
    appName: "BookCafe",
    baseURL,
    database: new Database(databasePath),
    emailAndPassword: {
      enabled: true
    },
    trustedOrigins: getTrustedOrigins(options, baseURL),
    plugins: [username()]
  });
};

/**
 * Returns a cached Better Auth instance for the active shared database.
 */
export const getAuth = (
  options: AuthOptions
): ReturnType<typeof createAuth> => {
  const baseURL = getAuthBaseURL(options);
  const cacheKey = [
    resolve(options.databasePath),
    options.host,
    options.port,
    baseURL,
    ...getTrustedOrigins(options, baseURL)
  ].join("\0");

  if (cachedAuth?.cacheKey === cacheKey) {
    return cachedAuth.auth;
  }

  const auth = createAuth(options);
  cachedAuth = { cacheKey, auth };
  return auth;
};

/**
 * Applies Better Auth migrations for the active auth database.
 */
export const runAuthMigrations = async (
  auth: ReturnType<typeof createAuth>
): Promise<void> => {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
};

/**
 * Builds the canonical Better Auth server URL for the active config.
 */
const getAuthBaseURL = (options: AuthOptions): string =>
  process.env.BOOKCAFE_BASE_URL ?? createServerOrigin(options);

/**
 * Builds the origins Better Auth should trust for local app and Nuxt dev usage.
 */
const getTrustedOrigins = (options: AuthOptions, baseURL: string): string[] =>
  getBookCafeClientOrigins([
    baseURL,
    `http://127.0.0.1:${options.port}`,
    `http://localhost:${options.port}`
  ]);
