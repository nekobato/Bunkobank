/**
 * State-machine tests for the BookCafe desktop manager controller.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createDesktopManagerController,
  validateSetupInput,
  type DesktopManagerDependencies
} from "./manager.js";
import type {
  DesktopEnvironment,
  ManagedServerRuntimeEvent,
  TauriDesktopRuntime
} from "./runtime.js";

describe("desktop manager controller", () => {
  it("initializes a fresh install with the native app data directory", async () => {
    const runtime = createRuntime();
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus: vi.fn(async () => createStatus("unreachable")),
      readSetupStatus: vi.fn(),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();

    expect(manager.getState()).toMatchObject({
      phase: "ready",
      activeConfig: { host: "127.0.0.1", port: 4510 },
      server: { phase: "stopped", childPid: null, canStart: true },
      setup: { phase: "unknown" },
      draft: {
        dataDir: "/Users/alice/Library/Application Support/BookCafe",
        collectionRoots: []
      }
    });
  });

  it("reports a reachable external server without offering Stop", async () => {
    const runtime = createRuntime();
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus: vi.fn(async () => createStatus("reachable")),
      readSetupStatus: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/status",
        status: {
          setupComplete: true,
          host: "127.0.0.1" as const,
          port: 4510,
          thumbnails: { enabled: true }
        }
      })),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();

    expect(manager.getState()).toMatchObject({
      server: {
        phase: "running",
        managedByDesktop: false,
        canStop: false
      },
      setup: { phase: "complete" }
    });
    await expect(manager.stopServer()).resolves.toBe(false);
    expect(runtime.stopManagedServer).not.toHaveBeenCalled();
  });

  it("starts the sidecar with the fixed config path and reaches setup", async () => {
    const runtime = createRuntime();
    const readServerStatus = vi
      .fn()
      .mockResolvedValueOnce(createStatus("unreachable"))
      .mockResolvedValueOnce(createStatus("reachable"));
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus,
      readSetupStatus: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/status",
        status: {
          setupComplete: false,
          host: "127.0.0.1" as const,
          port: 4510,
          thumbnails: { enabled: true }
        }
      })),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await expect(manager.startServer()).resolves.toBe(true);

    expect(runtime.spawnManagedServer).toHaveBeenCalledWith(
      expect.objectContaining({
        commandName: "binaries/bookcafe-server",
        args: [
          "--config",
          "/Users/alice/Library/Application Support/dev.bookcafe.desktop/config.json"
        ]
      }),
      expect.any(Function)
    );
    expect(manager.getState()).toMatchObject({
      server: {
        phase: "running",
        childPid: 4312,
        managedByDesktop: true,
        canStop: true
      },
      setup: { phase: "required" }
    });
  });

  it("moves to crashed when the managed sidecar terminates", async () => {
    let emitEvent: ((event: ManagedServerRuntimeEvent) => void) | undefined;
    const runtime = createRuntime({
      spawnManagedServer: vi.fn(async (_plan, onEvent) => {
        emitEvent = onEvent;
        return { pid: 4312 };
      })
    });
    const readServerStatus = vi
      .fn()
      .mockResolvedValueOnce(createStatus("unreachable"))
      .mockResolvedValueOnce(createStatus("reachable"));
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus,
      readSetupStatus: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/status",
        status: {
          setupComplete: false,
          host: "127.0.0.1" as const,
          port: 4510,
          thumbnails: { enabled: true }
        }
      })),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await manager.startServer();
    emitEvent?.({ type: "terminated", code: 1, signal: null });

    expect(manager.getState()).toMatchObject({
      server: { phase: "crashed", childPid: null, canStop: false },
      error: "BookCafe server exited with code 1."
    });
  });

  it("does not overwrite an early sidecar exit after spawn resolves", async () => {
    const runtime = createRuntime({
      spawnManagedServer: vi.fn(async (_plan, onEvent) => {
        onEvent?.({ type: "terminated", code: 78, signal: null });
        return { pid: 4312 };
      })
    });
    const readServerStatus = vi.fn(async () => createStatus("unreachable"));
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus,
      readSetupStatus: vi.fn(),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await expect(manager.startServer()).resolves.toBe(false);

    expect(manager.getState()).toMatchObject({
      server: {
        phase: "crashed",
        childPid: null,
        managedByDesktop: false,
        canStart: true,
        canStop: false
      },
      error: "BookCafe server exited with code 78."
    });
    expect(readServerStatus).toHaveBeenCalledTimes(1);
  });

  it("restarts a managed server when setup changes its endpoint", async () => {
    const runtime = createRuntime();
    const readServerStatus = vi
      .fn()
      .mockResolvedValueOnce(createStatus("unreachable"))
      .mockResolvedValue(createStatus("reachable"));
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus,
      readSetupStatus: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/status",
        status: {
          setupComplete: false,
          host: "127.0.0.1" as const,
          port: 4510,
          thumbnails: { enabled: true }
        }
      })),
      submitInitialSetup: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/initial-user",
        request: {
          username: "admin",
          password: "password123",
          dataDir: "/Users/alice/BookCafe",
          collectionRoots: ["/Users/alice/Books"],
          host: "127.0.0.1" as const,
          port: 4525,
          thumbnails: { enabled: true }
        },
        status: {
          setupComplete: true,
          host: "127.0.0.1" as const,
          port: 4525,
          thumbnails: { enabled: true }
        }
      })),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await manager.startServer();
    await expect(
      manager.submitSetup({
        username: "admin",
        password: "password123",
        confirmPassword: "password123",
        dataDir: "/Users/alice/BookCafe",
        collectionRoots: ["/Users/alice/Books"],
        host: "127.0.0.1",
        port: 4525,
        thumbnails: { enabled: true }
      })
    ).resolves.toBe(true);

    expect(runtime.stopManagedServer).toHaveBeenCalledWith(4312);
    expect(runtime.spawnManagedServer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [
          "--config",
          "/Users/alice/Library/Application Support/dev.bookcafe.desktop/config.json"
        ],
        browserUrl: "http://127.0.0.1:4525/"
      }),
      expect.any(Function)
    );
    expect(manager.getState()).toMatchObject({
      activeConfig: { host: "127.0.0.1", port: 4525 },
      setup: { phase: "complete" },
      draft: { password: "", confirmPassword: "" }
    });
  });

  it("keeps completed external setup in restart-required state", async () => {
    const runtime = createRuntime();
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus: vi.fn(async () => createStatus("reachable")),
      readSetupStatus: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/status",
        status: {
          setupComplete: false,
          host: "127.0.0.1" as const,
          port: 4510,
          thumbnails: { enabled: true }
        }
      })),
      submitInitialSetup: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/initial-user",
        request: {
          username: "admin",
          password: "password123",
          dataDir: "/Users/alice/BookCafe",
          collectionRoots: ["/Users/alice/Books"],
          host: "127.0.0.1" as const,
          port: 4525,
          thumbnails: { enabled: true }
        },
        status: {
          setupComplete: true,
          host: "127.0.0.1" as const,
          port: 4525,
          thumbnails: { enabled: true }
        }
      })),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await expect(
      manager.submitSetup({
        username: "admin",
        password: "password123",
        confirmPassword: "password123",
        dataDir: "/Users/alice/BookCafe",
        collectionRoots: ["/Users/alice/Books"],
        host: "127.0.0.1",
        port: 4525,
        thumbnails: { enabled: true }
      })
    ).resolves.toBe(true);

    expect(manager.getState()).toMatchObject({
      activeConfig: { host: "127.0.0.1", port: 4510 },
      persistedConfig: { setupComplete: true, port: 4525 },
      server: { managedByDesktop: false },
      setup: { phase: "restart-required" },
      draft: { password: "", confirmPassword: "" },
      announcement:
        "Setup saved. Restart the external server to use the new endpoint."
    });
    expect(runtime.stopManagedServer).not.toHaveBeenCalled();
  });

  it("reads and changes Windows autostart through the runtime", async () => {
    const runtime = createRuntime({
      readEnvironment: vi.fn(async () => ({
        ...environment,
        platform: "windows" as const
      })),
      isWindowsAutostartEnabled: vi.fn(async () => false)
    });
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus: vi.fn(async () => createStatus("unreachable")),
      readSetupStatus: vi.fn(),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    expect(manager.getState().startup.phase).toBe("disabled");

    await manager.setStartupEnabled(true);
    expect(runtime.enableWindowsAutostart).toHaveBeenCalledTimes(1);
    expect(manager.getState().startup.phase).toBe("enabled");
  });

  it("starts the managed server when the Windows manager opens", async () => {
    const runtime = createRuntime({
      readEnvironment: vi.fn(async () => ({
        ...environment,
        platform: "windows" as const
      }))
    });
    const readServerStatus = vi
      .fn()
      .mockResolvedValueOnce(createStatus("unreachable"))
      .mockResolvedValueOnce(createStatus("reachable"));
    const manager = createDesktopManagerController({
      runtime,
      readServerStatus,
      readSetupStatus: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/status",
        status: {
          setupComplete: false,
          host: "127.0.0.1" as const,
          port: 4510,
          thumbnails: { enabled: true }
        }
      })),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();

    expect(runtime.spawnManagedServer).toHaveBeenCalledTimes(1);
    expect(manager.getState().server).toMatchObject({
      phase: "running",
      managedByDesktop: true,
      childPid: 4312
    });
  });
});

describe("validateSetupInput", () => {
  it("returns field errors without silently replacing invalid values", () => {
    expect(
      validateSetupInput({
        username: "",
        password: "short",
        confirmPassword: "different",
        dataDir: "",
        collectionRoots: [],
        host: "127.0.0.1",
        port: 0,
        thumbnails: { enabled: true }
      })
    ).toMatchObject({
      valid: false,
      errors: {
        username: expect.any(String),
        password: expect.any(String),
        confirmPassword: expect.any(String),
        port: expect.any(String)
      }
    });
  });
});

const environment: DesktopEnvironment = {
  platform: "macos",
  homeDir: "/Users/alice",
  appConfigDir: "/Users/alice/Library/Application Support/dev.bookcafe.desktop",
  appDataDir: "/Users/alice/Library/Application Support/BookCafe",
  configPath:
    "/Users/alice/Library/Application Support/dev.bookcafe.desktop/config.json",
  logDir: "/Users/alice/Library/Logs/dev.bookcafe.desktop",
  sidecarName: "binaries/bookcafe-server",
  sidecarPath: "/Applications/BookCafe.app/Contents/MacOS/bookcafe-server"
};

/**
 * Creates a complete runtime mock with optional method overrides.
 */
const createRuntime = (
  overrides: Partial<TauriDesktopRuntime> = {}
): TauriDesktopRuntime => ({
  readEnvironment: vi.fn(async () => environment),
  readServerConfig: vi.fn(async () => null),
  pickDirectory: vi.fn(async () => null),
  pickDirectories: vi.fn(async () => []),
  spawnManagedServer: vi.fn(async () => ({ pid: 4312 })),
  stopManagedServer: vi.fn(async () => undefined),
  openUrl: vi.fn(async () => undefined),
  readMacLaunchAgentPlist: vi.fn(async () => null),
  installMacLaunchAgent: vi.fn(async () => undefined),
  removeMacLaunchAgent: vi.fn(async () => undefined),
  isWindowsAutostartEnabled: vi.fn(async () => false),
  enableWindowsAutostart: vi.fn(async () => undefined),
  disableWindowsAutostart: vi.fn(async () => undefined),
  ...overrides
});

/**
 * Creates a managed server status fixture.
 */
const createStatus = (
  status: "reachable" | "unreachable"
): Awaited<ReturnType<DesktopManagerDependencies["readServerStatus"]>> => ({
  status,
  reachable: status === "reachable",
  responding: status === "reachable",
  url: "http://127.0.0.1:4510/api/health",
  statusCode: status === "reachable" ? 200 : null,
  service: status === "reachable" ? "bookcafe-server" : null,
  error: status === "reachable" ? null : "connection refused"
});
