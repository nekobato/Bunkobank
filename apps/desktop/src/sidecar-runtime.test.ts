import { expect, it } from "vitest";

import {
  assertSidecarNodeVersion,
  resolvePkgTarget
} from "../scripts/sidecar-plan.mjs";

it.each(["24.22.1", "24.22.2", "24.23.0"])(
  "accepts patched Node 24 runtime %s",
  (version) => {
    expect(() => assertSidecarNodeVersion(version)).not.toThrow();
  }
);

it.each(["24.11.1", "24.22.0", "22.23.4", "26.12.1", "24.22"])(
  "rejects an old or incompatible runtime %s",
  (version) => {
    expect(() => assertSidecarNodeVersion(version)).toThrow("24.22.1");
  }
);

it.each([
  ["darwin", "arm64", "node24.22.1-macos-arm64"],
  ["linux", "x64", "node24.22.1-linux-x64"],
  ["win32", "x64", "node24.22.1-win-x64"]
] as const)("pins the embedded runtime for %s/%s", (platform, arch, target) => {
  expect(resolvePkgTarget({ platform, arch })).toBe(target);
});
