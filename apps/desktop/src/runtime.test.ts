/**
 * Behavioral tests for Tauri desktop runtime adapters.
 */

import { describe, expect, it, vi } from "vitest";

import { createManagedServerSidecarLaunchPlan } from "./index.js";
import {
  createTauriDesktopRuntime,
  type RuntimeChild,
  type RuntimeSidecarCommand,
  type TauriRuntimeBindings
} from "./runtime.js";

describe("createTauriDesktopRuntime", () => {
  it("keeps the Tauri child handle and stops only the managed child", async () => {
    const child = createChild(4312);
    const command = createSidecarCommand(child);
    const bindings = createBindings({
      createSidecar: vi.fn(() => command)
    });
    const runtime = createTauriDesktopRuntime(bindings);
    const launchPlan = createManagedServerSidecarLaunchPlan({
      sidecarName: "binaries/bookcafe-server",
      configPath:
        "/Users/alice/Library/Application Support/BookCafe/config.json",
      config: { host: "127.0.0.1", port: 4510 }
    });

    await expect(runtime.spawnManagedServer(launchPlan)).resolves.toEqual({
      pid: 4312
    });
    expect(bindings.createSidecar).toHaveBeenCalledWith(
      "binaries/bookcafe-server",
      [
        "--config",
        "/Users/alice/Library/Application Support/BookCafe/config.json"
      ]
    );

    await expect(runtime.stopManagedServer(4312)).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledTimes(1);
    await expect(runtime.stopManagedServer(4312)).rejects.toThrow(
      "Managed sidecar child 4312 is not available."
    );
  });

  it("clears the managed handle and emits sidecar lifecycle events", async () => {
    const child = createChild(4313);
    const command = createSidecarCommand(child);
    const runtime = createTauriDesktopRuntime(
      createBindings({ createSidecar: () => command })
    );
    const events: unknown[] = [];

    await runtime.spawnManagedServer(
      createManagedServerSidecarLaunchPlan({
        sidecarName: "binaries/bookcafe-server",
        configPath: "/tmp/bookcafe/config.json",
        config: { host: "127.0.0.1", port: 4510 }
      }),
      (event) => events.push(event)
    );

    command.emitStdout("ready");
    command.emitStderr("warning");
    command.emitClose({ code: 1, signal: null });

    expect(events).toEqual([
      { type: "stdout", value: "ready" },
      { type: "stderr", value: "warning" },
      { type: "terminated", code: 1, signal: null }
    ]);
    await expect(runtime.stopManagedServer(4313)).rejects.toThrow(
      "Managed sidecar child 4313 is not available."
    );
  });

  it("rejects a sidecar plan without the required config argument", async () => {
    const runtime = createTauriDesktopRuntime(createBindings());

    await expect(
      runtime.spawnManagedServer(
        createManagedServerSidecarLaunchPlan({
          sidecarName: "binaries/bookcafe-server",
          config: { host: "127.0.0.1", port: 4510 }
        })
      )
    ).rejects.toThrow("Managed sidecar requires --config with one path.");
  });

  it("normalizes native directory picker results", async () => {
    const openDirectory = vi
      .fn()
      .mockResolvedValueOnce("/Users/alice/BookCafe")
      .mockResolvedValueOnce(["/Books/Manga", "/Books/Art"])
      .mockResolvedValueOnce(null);
    const runtime = createTauriDesktopRuntime(
      createBindings({ openDirectory })
    );

    await expect(runtime.pickDirectory()).resolves.toBe(
      "/Users/alice/BookCafe"
    );
    await expect(runtime.pickDirectories()).resolves.toEqual([
      "/Books/Manga",
      "/Books/Art"
    ]);
    await expect(runtime.pickDirectory()).resolves.toBeNull();
  });

  it("delegates environment, config, URL, and autostart operations", async () => {
    const environment = {
      platform: "windows" as const,
      homeDir: "C:\\Users\\alice",
      appConfigDir: "C:\\Users\\alice\\AppData\\Roaming\\BookCafe",
      appDataDir: "C:\\Users\\alice\\AppData\\Roaming\\BookCafe",
      configPath: "C:\\Users\\alice\\AppData\\Roaming\\BookCafe\\config.json",
      logDir: "C:\\Users\\alice\\AppData\\Roaming\\BookCafe\\logs",
      sidecarName: "binaries/bookcafe-server",
      sidecarPath: "C:\\Program Files\\BookCafe\\bookcafe-server.exe"
    };
    const serverConfig = {
      dataDir: "C:\\Users\\alice\\BookCafe",
      host: "127.0.0.1" as const,
      port: 4510,
      thumbnails: { enabled: true }
    };
    const invoke = vi.fn(async (command: string) =>
      command === "get_desktop_environment" ? environment : serverConfig
    ) as TauriRuntimeBindings["invoke"];
    const openUrl = vi.fn(async () => undefined);
    const enableAutostart = vi.fn(async () => undefined);
    const disableAutostart = vi.fn(async () => undefined);
    const isAutostartEnabled = vi.fn(async () => true);
    const runtime = createTauriDesktopRuntime(
      createBindings({
        invoke,
        openUrl,
        enableAutostart,
        disableAutostart,
        isAutostartEnabled
      })
    );

    await expect(runtime.readEnvironment()).resolves.toEqual(environment);
    await expect(runtime.readServerConfig()).resolves.toEqual(serverConfig);
    await runtime.openUrl("http://127.0.0.1:4510/");
    await expect(runtime.isWindowsAutostartEnabled()).resolves.toBe(true);
    await runtime.enableWindowsAutostart();
    await runtime.disableWindowsAutostart();

    expect(invoke).toHaveBeenNthCalledWith(1, "get_desktop_environment");
    expect(invoke).toHaveBeenNthCalledWith(2, "read_server_config");
    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:4510/");
    expect(enableAutostart).toHaveBeenCalledTimes(1);
    expect(disableAutostart).toHaveBeenCalledTimes(1);
  });
});

/**
 * Creates a mock sidecar child.
 */
const createChild = (pid: number): RuntimeChild => ({
  pid,
  kill: vi.fn(async () => undefined)
});

/**
 * Creates an event-capable mock sidecar command.
 */
const createSidecarCommand = (
  child: RuntimeChild
): RuntimeSidecarCommand & {
  emitClose: (event: { code: number | null; signal: number | null }) => void;
  emitStdout: (value: string) => void;
  emitStderr: (value: string) => void;
} => {
  const listeners = {
    close: [] as Array<
      (event: { code: number | null; signal: number | null }) => void
    >,
    error: [] as Array<(value: string) => void>,
    stdout: [] as Array<(value: string) => void>,
    stderr: [] as Array<(value: string) => void>
  };

  return {
    onClose: (listener) => listeners.close.push(listener),
    onError: (listener) => listeners.error.push(listener),
    stdout: {
      on: (_event, listener) => listeners.stdout.push(listener)
    },
    stderr: {
      on: (_event, listener) => listeners.stderr.push(listener)
    },
    spawn: async () => child,
    emitClose: (event) =>
      listeners.close.forEach((listener) => listener(event)),
    emitStdout: (value) =>
      listeners.stdout.forEach((listener) => listener(value)),
    emitStderr: (value) =>
      listeners.stderr.forEach((listener) => listener(value))
  };
};

/**
 * Creates a complete runtime binding fixture with optional overrides.
 */
const createBindings = (
  overrides: Partial<TauriRuntimeBindings> = {}
): TauriRuntimeBindings => ({
  invoke: vi.fn(async () => null) as TauriRuntimeBindings["invoke"],
  createSidecar: vi.fn(() => createSidecarCommand(createChild(4312))),
  openDirectory: vi.fn(async () => null),
  openUrl: vi.fn(async () => undefined),
  isAutostartEnabled: vi.fn(async () => false),
  enableAutostart: vi.fn(async () => undefined),
  disableAutostart: vi.fn(async () => undefined),
  ...overrides
});
