/**
 * Derives initial setup state from the Better Auth user table.
 */

import { statSync } from "node:fs";

import { type BindHost } from "@bookcafe/config";
import Database from "better-sqlite3";

export type InitializationState =
  | { status: "uninitialized" }
  | { status: "initialized" }
  | { status: "unavailable"; cause: unknown };

/**
 * Reads whether the shared SQLite database contains a Better Auth user.
 *
 * Database open, query, and close effects are contained within this boundary.
 */
export const readInitializationState = (
  databasePath: string
): InitializationState => {
  try {
    statSync(databasePath);
  } catch (cause) {
    return isMissingPathError(cause)
      ? { status: "uninitialized" }
      : { status: "unavailable", cause };
  }

  let database: Database.Database | null = null;
  let state: InitializationState;

  try {
    database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true
    });

    const userTable = database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user' LIMIT 1"
      )
      .get();

    if (!userTable) {
      state = { status: "uninitialized" };
    } else {
      const user = database.prepare('SELECT 1 FROM "user" LIMIT 1').get();
      state = user ? { status: "initialized" } : { status: "uninitialized" };
    }
  } catch (cause) {
    state = { status: "unavailable", cause };
  }

  if (database) {
    try {
      database.close();
    } catch (cause) {
      return { status: "unavailable", cause };
    }
  }

  return state;
};

/** Returns true only when a filesystem lookup proves the DB does not exist. */
const isMissingPathError = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Prevents an uninitialized or unreadable server from listening beyond loopback.
 */
export const resolveEffectiveBindHost = (
  configuredHost: BindHost,
  state: InitializationState
): BindHost => (state.status === "initialized" ? configuredHost : "127.0.0.1");
