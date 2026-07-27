/**
 * Tests for accepting only real loopback client addresses during setup.
 */

import { describe, expect, it } from "vitest";

import { isLoopbackAddress } from "./loopback.js";

describe("isLoopbackAddress", () => {
  it.each([
    "127.0.0.1",
    "127.10.20.30",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1"
  ])("accepts %s", (address) => {
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "0.0.0.0",
    "192.168.1.10",
    "::ffff:192.168.1.10",
    "example.test"
  ])("rejects %s", (address) => {
    expect(isLoopbackAddress(address)).toBe(false);
  });
});
