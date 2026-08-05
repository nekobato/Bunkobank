import { expect, it } from "vitest";

import { isLoopbackAddress } from "./loopback.js";

it("allows setup only from loopback addresses", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    expect(isLoopbackAddress(address)).toBe(true);
  }
  for (const address of [undefined, "0.0.0.0", "192.168.1.10"]) {
    expect(isLoopbackAddress(address)).toBe(false);
  }
});
