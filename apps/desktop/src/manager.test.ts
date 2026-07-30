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
  it("initializes a fresh install with an empty account draft", async () => {
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
        username: "",
        password: "",
        confirmPassword: ""
      }
    });
  });

  it("persists a valid port while the server is stopped", async () => {
    const runtime = createRuntime({
      writeServerPort: vi.fn(async (port) => ({
        host: "127.0.0.1" as const,
        port,
        thumbnails: { enabled: true }
      }))
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
    manager.updatePortDraft(4511);
    await expect(manager.saveServerPort()).resolves.toBe(true);

    expect(runtime.writeServerPort).toHaveBeenCalledWith(4511);
    expect(manager.getState()).toMatchObject({
      activeConfig: { host: "127.0.0.1", port: 4511 },
      network: { phase: "saved", portDraft: 4511, fieldErrors: {} }
    });
  });

  it("rejects an invalid port before native persistence", async () => {
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
    manager.updatePortDraft(null);
    await expect(manager.saveServerPort()).resolves.toBe(false);

    expect(runtime.writeServerPort).not.toHaveBeenCalled();
    expect(manager.getState().network).toMatchObject({
      phase: "error",
      fieldErrors: { port: expect.any(String) }
    });
  });

  it("reloads a Web-saved port before probing a stopped server", async () => {
    const readServerConfig = vi
      .fn()
      .mockResolvedValueOnce({
        host: "127.0.0.1" as const,
        port: 4510,
        thumbnails: { enabled: true }
      })
      .mockResolvedValueOnce({
        host: "127.0.0.1" as const,
        port: 4511,
        thumbnails: { enabled: true }
      });
    const readServerStatus = vi.fn(async () => createStatus("unreachable"));
    const manager = createDesktopManagerController({
      runtime: createRuntime({ readServerConfig }),
      readServerStatus,
      readSetupStatus: vi.fn(),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await manager.refreshServer({ silent: true });

    expect(readServerStatus).toHaveBeenLastCalledWith({
      host: "127.0.0.1",
      port: 4511
    });
    expect(manager.getState().activeConfig).toEqual({
      host: "127.0.0.1",
      port: 4511
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

  it("opens initial setup in the Web UI when no account exists", async () => {
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
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await expect(manager.openWebUi()).resolves.toBe(true);

    expect(runtime.openUrl).toHaveBeenCalledWith("http://127.0.0.1:4510/setup");
  });

  it("keeps background health probes silent", async () => {
    const readSetupStatus = vi.fn(async () => ({
      url: "http://127.0.0.1:4510/api/setup/status",
      status: {
        setupComplete: true,
        host: "127.0.0.1" as const,
        port: 4510,
        thumbnails: { enabled: true }
      }
    }));
    const manager = createDesktopManagerController({
      runtime: createRuntime(),
      readServerStatus: vi.fn(async () => createStatus("reachable")),
      readSetupStatus,
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    const announcement = manager.getState().announcement;
    await manager.refreshServer({ silent: true });

    expect(readSetupStatus).toHaveBeenCalledTimes(1);
    expect(manager.getState().announcement).toBe(announcement);
  });

  it("does not offer initial setup when the database is unavailable", async () => {
    const manager = createDesktopManagerController({
      runtime: createRuntime(),
      readServerStatus: vi.fn(async () => createStatus("reachable")),
      readSetupStatus: vi.fn(async () => {
        throw Object.assign(new Error("BookCafe data is unavailable."), {
          status: 503,
          code: "DATA_UNAVAILABLE"
        });
      }),
      submitInitialSetup: vi.fn(),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();

    expect(manager.getState()).toMatchObject({
      phase: "ready",
      server: { phase: "running" },
      setup: { phase: "unavailable" },
      error: null
    });
  });

  it("moves setup submission to unavailable when the database cannot be read", async () => {
    const manager = createDesktopManagerController({
      runtime: createRuntime(),
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
      submitInitialSetup: vi.fn(async () => {
        throw Object.assign(new Error("BookCafe data is unavailable."), {
          status: 503,
          code: "DATA_UNAVAILABLE"
        });
      }),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await expect(
      manager.submitSetup({
        username: "admin",
        password: "password123",
        confirmPassword: "password123"
      })
    ).resolves.toBe(false);

    expect(manager.getState()).toMatchObject({
      setup: { phase: "unavailable" },
      error: null
    });
  });

  it("preserves a stable invalid-credentials message for presentation", async () => {
    const manager = createDesktopManagerController({
      runtime: createRuntime(),
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
      submitInitialSetup: vi.fn(async () => {
        throw Object.assign(new Error("wrapped server response"), {
          status: 401,
          code: "INVALID_CREDENTIALS"
        });
      }),
      delay: vi.fn(async () => undefined),
      maxStartAttempts: 2
    });

    await manager.initialize();
    await manager.submitSetup({
      username: "admin",
      password: "password123",
      confirmPassword: "password123"
    });

    expect(manager.getState()).toMatchObject({
      setup: { phase: "error" },
      error: "Username or password is invalid."
    });
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

  it("creates the initial account without restarting the managed server", async () => {
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
          setupComplete: false
        }
      })),
      submitInitialSetup: vi.fn(async () => ({
        url: "http://127.0.0.1:4510/api/setup/initial-user",
        request: {
          username: "admin",
          password: "password123"
        },
        status: {
          setupComplete: true
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
        confirmPassword: "password123"
      })
    ).resolves.toBe(true);

    expect(runtime.stopManagedServer).not.toHaveBeenCalled();
    expect(runtime.spawnManagedServer).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      activeConfig: { host: "127.0.0.1", port: 4510 },
      setup: { phase: "complete" },
      draft: { username: "admin", password: "", confirmPassword: "" },
      announcement: "BookCafe setup is complete."
    });
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
        confirmPassword: "different"
      })
    ).toMatchObject({
      valid: false,
      errors: {
        username: expect.any(String),
        password: expect.any(String),
        confirmPassword: expect.any(String)
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
  writeServerPort: vi.fn(async (port) => ({
    host: "127.0.0.1" as const,
    port,
    thumbnails: { enabled: true }
  })),
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
