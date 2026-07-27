/**
 * Tests for deriving initial setup state from the Better Auth user table.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveStatePaths } from "@bookcafe/config";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  readInitializationState,
  resolveEffectiveBindHost
} from "./initialization.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readInitializationState", () => {
  it("returns uninitialized when the database does not exist", () => {
    const dataDir = createTempDataDir();

    expect(
      readInitializationState(resolveStatePaths(dataDir).databasePath)
    ).toEqual({
      status: "uninitialized"
    });
  });

  it("returns uninitialized when the user table does not exist", () => {
    const dataDir = createTempDataDir();
    const database = openTestDatabase(dataDir);

    database.exec("CREATE TABLE example (id TEXT PRIMARY KEY)");
    database.close();

    expect(
      readInitializationState(resolveStatePaths(dataDir).databasePath)
    ).toEqual({
      status: "uninitialized"
    });
  });

  it("returns uninitialized when the user table is empty", () => {
    const dataDir = createTempDataDir();
    const database = openTestDatabase(dataDir);

    database.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY)');
    database.close();

    expect(
      readInitializationState(resolveStatePaths(dataDir).databasePath)
    ).toEqual({
      status: "uninitialized"
    });
  });

  it("returns initialized when a Better Auth user exists", () => {
    const dataDir = createTempDataDir();
    const database = openTestDatabase(dataDir);

    database.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY)');
    database.prepare('INSERT INTO "user" (id) VALUES (?)').run("existing-user");
    database.close();

    expect(
      readInitializationState(resolveStatePaths(dataDir).databasePath)
    ).toEqual({
      status: "initialized"
    });
  });

  it("returns unavailable with the cause when SQLite is corrupt", () => {
    const dataDir = createTempDataDir();
    const { databasePath } = resolveStatePaths(dataDir);
    writeFileSync(databasePath, "not a sqlite database");

    const state = readInitializationState(databasePath);

    expect(state.status).toBe("unavailable");
    expect(state).toHaveProperty("cause");
  });

  it.runIf(process.platform !== "win32")(
    "returns unavailable when the database path cannot be inspected",
    () => {
      const dataDir = createTempDataDir();
      const database = openTestDatabase(dataDir);
      database.close();
      chmodSync(dataDir, 0o000);

      try {
        const state = readInitializationState(
          resolveStatePaths(dataDir).databasePath
        );

        expect(state.status).toBe("unavailable");
        expect(state).toHaveProperty("cause");
      } finally {
        chmodSync(dataDir, 0o700);
      }
    }
  );
});

describe("resolveEffectiveBindHost", () => {
  it("forces loopback until a user exists", () => {
    expect(
      resolveEffectiveBindHost("0.0.0.0", { status: "uninitialized" })
    ).toBe("127.0.0.1");
  });

  it("forces loopback when the database is unavailable", () => {
    expect(
      resolveEffectiveBindHost("0.0.0.0", {
        status: "unavailable",
        cause: new Error("unreadable")
      })
    ).toBe("127.0.0.1");
  });

  it("uses the configured host after a user exists", () => {
    expect(resolveEffectiveBindHost("0.0.0.0", { status: "initialized" })).toBe(
      "0.0.0.0"
    );
  });
});

/**
 * Creates one isolated application data directory.
 */
const createTempDataDir = (): string => {
  const dataDir = mkdtempSync(join(tmpdir(), "bookcafe-initialization-"));
  tempDirs.push(dataDir);
  return dataDir;
};

/**
 * Opens the BookCafe SQLite path for test fixture creation.
 */
const openTestDatabase = (dataDir: string): Database.Database =>
  new Database(resolveStatePaths(dataDir).databasePath);
