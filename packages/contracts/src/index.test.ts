import { expect, it } from "vitest";

import { healthResponseSchema, initialSetupRequestSchema } from "./index.js";

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
