import { expect, it } from "vitest";

import {
  healthResponseSchema,
  initialSetupRequestSchema,
  libraryCreateRequestSchema
} from "./index.js";

it("keeps setup and health payloads compatible with the public contract", () => {
  expect(
    initialSetupRequestSchema.parse({
      username: " admin ",
      password: "password123",
      ignored: true
    })
  ).toEqual({ username: "admin", password: "password123" });
  expect(
    healthResponseSchema.parse({ ok: true, service: "bunkobank-server" })
  ).toEqual({ ok: true, service: "bunkobank-server" });
});

it("requires a password only for encrypted libraries", () => {
  expect(
    libraryCreateRequestSchema.parse({
      kind: "directory",
      name: "Shared",
      rootPath: "/books"
    })
  ).toEqual({ kind: "directory", name: "Shared", rootPath: "/books" });
  expect(
    libraryCreateRequestSchema.safeParse({
      kind: "encrypted",
      name: "Private",
      rootPath: "/vault"
    }).success
  ).toBe(false);
});
