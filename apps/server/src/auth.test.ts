import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";

const directories: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
  directories
    .splice(0)
    .forEach((directory) =>
      rmSync(directory, { recursive: true, force: true })
    );
  vi.unstubAllEnvs();
});

it("migrates existing auth storage and preserves username login, sessions and logout", async () => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "test-only-bunkobank-auth-secret-at-least-32-chars"
  );
  vi.stubEnv("BUNKOBANK_BASE_URL", "http://127.0.0.1:4510");
  vi.resetModules();
  const { createAuth, runAuthMigrations } = await import("./auth.js");
  const directory = mkdtempSync(join(tmpdir(), "bunkobank-auth-test-"));
  directories.push(directory);
  const options = {
    databasePath: join(directory, "auth.sqlite"),
    host: "127.0.0.1" as const,
    port: 4510
  };
  let auth = createAuth(options);
  databases.push(auth.options.database as Database.Database);
  await runAuthMigrations(auth);
  // Better Auth disables these in test mode; explicitly exercise both checks.
  (await auth.$context).skipOriginCheck = false;
  (await auth.$context).skipCSRFCheck = false;
  const request = (
    path: string,
    body?: object,
    cookie?: string,
    origin = "http://127.0.0.1:3000"
  ) =>
    auth.handler(
      new Request(`http://127.0.0.1:4510/api/auth/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin,
          "sec-fetch-site": origin.includes("untrusted")
            ? "cross-site"
            : "same-site",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })
    );
  const password = "test-only-strong-password-123";
  const signup = await request("sign-up/email", {
    name: "Reader",
    username: "reader",
    email: "reader@example.invalid",
    password
  });
  expect(signup.status).toBe(200);
  // Reopen and rerun migrations against the persisted user before signing in.
  databases.pop()!.close();
  auth = createAuth(options);
  databases.push(auth.options.database as Database.Database);
  await runAuthMigrations(auth);
  // Better Auth disables these in test mode; explicitly exercise both checks.
  (await auth.$context).skipOriginCheck = false;
  (await auth.$context).skipCSRFCheck = false;
  expect(
    (
      await request("sign-in/username", {
        username: "reader",
        password: "wrong-password"
      })
    ).status
  ).toBe(401);
  const login = await request("sign-in/username", {
    username: "reader",
    password
  });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token=");
  const session = await request("get-session", undefined, cookie);
  expect(await session.json()).toMatchObject({
    user: { username: "reader", email: "reader@example.invalid" }
  });
  expect(await (await request("get-session")).json()).toBeNull();
  expect(
    (await request("sign-out", {}, cookie, "https://untrusted.example.invalid"))
      .status
  ).toBe(403);
  expect((await request("sign-out", {}, cookie)).status).toBe(200);
  expect(
    await (await request("get-session", undefined, cookie)).json()
  ).toBeNull();
});
