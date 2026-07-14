/**
 * Better Auth setup for the Hono server.
 */

import { mkdirSync } from "node:fs";

import {
  createServerOrigin,
  resolveDataPaths,
  type AppConfig,
  type BindHost
} from "@bookcafe/config";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins";

import { getBookCafeClientOrigins } from "./origins.js";

interface CachedAuth {
  cacheKey: string;
  auth: ReturnType<typeof createAuth>;
}

interface AuthOptions {
  dataDir: string;
  host: BindHost;
  port: number;
}

type AuthInput = AppConfig | AuthOptions | string;

let cachedAuth: CachedAuth | null = null;

/**
 * Creates a Better Auth instance for a data directory.
 */
export const createAuth = (input: AuthInput) => {
  const options = toAuthOptions(input);
  const paths = resolveDataPaths(options.dataDir);
  const baseURL = getAuthBaseURL(options);
  mkdirSync(paths.root, { recursive: true });

  return betterAuth({
    appName: "BookCafe",
    baseURL,
    database: new Database(paths.databasePath),
    emailAndPassword: {
      enabled: true
    },
    trustedOrigins: getTrustedOrigins(options, baseURL),
    plugins: [username()]
  });
};

/**
 * Returns a cached Better Auth instance for the active data directory.
 */
export const getAuth = (input: AuthInput): ReturnType<typeof createAuth> => {
  const options = toAuthOptions(input);
  const baseURL = getAuthBaseURL(options);
  const cacheKey = [
    options.dataDir,
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
 * Normalizes a config object or legacy data directory string for auth setup.
 */
const toAuthOptions = (input: AuthInput): AuthOptions =>
  typeof input === "string"
    ? {
        dataDir: input,
        host: "127.0.0.1",
        port: 4510
      }
    : {
        dataDir: input.dataDir,
        host: input.host,
        port: input.port
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
