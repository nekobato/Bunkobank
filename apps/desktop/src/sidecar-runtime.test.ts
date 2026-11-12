import { expect, it } from "vitest";

import {
  assertSidecarNodeVersion,
  resolvePkgTarget
} from "../scripts/sidecar-plan.mjs";

it.each(["26.13.1", "26.13.2", "26.14.0"])(
  "accepts patched Node 26 runtime %s",
  (version) => {
    expect(() => assertSidecarNodeVersion(version)).not.toThrow();
  }
);

it.each(["26.11.1", "26.12.0", "26.12.1", "26.13.0", "22.23.5", "24.22.3", "26.13"])(
  "rejects an old or incompatible runtime %s",
  (version) => {
    expect(() => assertSidecarNodeVersion(version)).toThrow("26.13.1");
  }
);

it.each([
  ["darwin", "arm64", "node26.13.1-macos-arm64"],
  ["linux", "x64", "node26.13.1-linux-x64"],
  ["win32", "x64", "node26.13.1-win-x64"]
] as const)("pins the embedded runtime for %s/%s", (platform, arch, target) => {
  expect(resolvePkgTarget({ platform, arch })).toBe(target);
});
