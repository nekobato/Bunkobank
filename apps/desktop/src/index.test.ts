import { describe, expect, it } from "vitest";

import {
  createBookCafeServerLaunchAgent,
  createDefaultSetupDraft,
  createInitialSetupRequest,
  createMacLaunchAgentInstallPlan,
  createMacLaunchAgentPath,
  createMacLaunchAgentPlist,
  createMacLaunchAgentRemovePlan,
  createManagedServerSidecarLaunchPlan,
  createManagedServerStartPlan,
  createManagedServerStatusReader,
  createManagedServerStopPlan,
  createManagedServerUrl,
  createWindowsAutostartPlan,
  getManagedServerHealthUrl,
  inspectMacLaunchAgent,
  inspectManagedServerLifecycle,
  inspectWindowsAutostart,
  normalizePort,
  normalizeSetupDraft,
  tauriAutostartPermissions,
  tauriShellKillPermission,
  tauriShellSpawnPermission
} from "./index.js";

describe("desktop setup helpers", () => {
  it("accepts the Tauri-resolved data directory for a default draft", () => {
    expect(createDefaultSetupDraft("/Users/alice/BookCafe")).toMatchObject({
      dataDir: "/Users/alice/BookCafe",
      host: "127.0.0.1",
      port: 4510
    });
  });

  it("normalizes unsafe setup draft values", () => {
    expect(
      normalizeSetupDraft({
        username: " admin ",
        password: "password123",
        dataDir: " /tmp/bookcafe ",
        host: "0.0.0.0",
        port: 70000,
        thumbnails: { enabled: false }
      })
    ).toMatchObject({
      username: "admin",
      password: "password123",
      dataDir: "/tmp/bookcafe",
      host: "0.0.0.0",
      port: 4510,
      thumbnails: { enabled: false }
    });
  });

  it("creates the Hono initial setup request body", () => {
    expect(
      createInitialSetupRequest({
        username: "admin",
        password: "password123",
        dataDir: "",
        host: "127.0.0.1",
        port: 4525,
        collectionRoots: ["/Users/alice/Books"],
        thumbnails: { enabled: false }
      })
    ).toEqual({
      username: "admin",
      password: "password123",
      dataDir: undefined,
      host: "127.0.0.1",
      port: 4525,
      collectionRoots: ["/Users/alice/Books"],
      thumbnails: { enabled: false }
    });
  });

  it("builds a local browser URL for a LAN-bound server", () => {
    expect(
      createManagedServerUrl(
        {
          host: "0.0.0.0",
          port: 4525
        },
        "/setup"
      )
    ).toBe("http://127.0.0.1:4525/setup");
  });

  it("normalizes invalid ports to the default server port", () => {
    expect(normalizePort(4530)).toBe(4530);
    expect(normalizePort(0)).toBe(4510);
    expect(normalizePort(4510.5)).toBe(4510);
  });
});

describe("desktop macOS launch agent helpers", () => {
  it("builds the LaunchAgent path for a label", () => {
    expect(
      createMacLaunchAgentPath("dev.bookcafe.server", "/Users/alice")
    ).toBe("/Users/alice/Library/LaunchAgents/dev.bookcafe.server.plist");
  });

  it("normalizes repeated separators in desktop-managed macOS paths", () => {
    expect(
      createMacLaunchAgentPath("dev.bookcafe.server", "/Users/alice/")
    ).toBe("/Users/alice/Library/LaunchAgents/dev.bookcafe.server.plist");

    expect(
      createBookCafeServerLaunchAgent({
        serverCommand: "/Applications/BookCafe.app/server",
        logDir: "/Users/alice/Library/Logs/BookCafe/"
      })
    ).toMatchObject({
      standardOutPath: "/Users/alice/Library/Logs/BookCafe/server.out.log",
      standardErrorPath: "/Users/alice/Library/Logs/BookCafe/server.err.log"
    });
  });

  it("escapes LaunchAgent plist string values", () => {
    expect(
      createMacLaunchAgentPlist({
        label: "dev.bookcafe.test",
        programArguments: ["/Applications/Book&Cafe/server", "--name=<dev>"],
        environmentVariables: {
          BOOKCAFE_CONFIG: "/Users/alice/BookCafe/config.json"
        },
        runAtLoad: true,
        keepAlive: false
      })
    ).toContain(
      "    <string>/Applications/Book&amp;Cafe/server</string>\n" +
        "    <string>--name=&lt;dev&gt;</string>"
    );
  });

  it("creates a BookCafe server LaunchAgent model", () => {
    const agent = createBookCafeServerLaunchAgent({
      serverCommand:
        "/Applications/BookCafe.app/Contents/MacOS/bookcafe-server",
      configPath:
        "/Users/alice/Library/Application Support/BookCafe/config.json",
      logDir: "/Users/alice/Library/Logs/BookCafe"
    });

    expect(agent).toEqual({
      label: "dev.bookcafe.server",
      programArguments: [
        "/Applications/BookCafe.app/Contents/MacOS/bookcafe-server"
      ],
      environmentVariables: {
        BOOKCAFE_CONFIG:
          "/Users/alice/Library/Application Support/BookCafe/config.json"
      },
      keepAlive: true,
      runAtLoad: true,
      standardErrorPath: "/Users/alice/Library/Logs/BookCafe/server.err.log",
      standardOutPath: "/Users/alice/Library/Logs/BookCafe/server.out.log"
    });
  });

  it("inspects missing, current, and outdated LaunchAgent plists", () => {
    const agent = createBookCafeServerLaunchAgent({
      serverCommand: "/Applications/BookCafe.app/Contents/MacOS/bookcafe-server"
    });
    const expectedPlist = createMacLaunchAgentPlist(agent);
    const baseInput = {
      agent,
      homeDir: "/Users/alice"
    };

    expect(
      inspectMacLaunchAgent({
        ...baseInput,
        currentPlist: null
      })
    ).toMatchObject({
      status: "missing",
      path: "/Users/alice/Library/LaunchAgents/dev.bookcafe.server.plist",
      expectedPlist,
      currentPlist: null
    });
    expect(
      inspectMacLaunchAgent({
        ...baseInput,
        currentPlist: expectedPlist
      })
    ).toMatchObject({
      status: "current",
      currentPlist: expectedPlist
    });
    expect(
      inspectMacLaunchAgent({
        ...baseInput,
        currentPlist: "<plist/>"
      })
    ).toMatchObject({
      status: "outdated",
      currentPlist: "<plist/>"
    });
  });

  it("plans LaunchAgent create, update, and no-op installs", () => {
    const agent = createBookCafeServerLaunchAgent({
      serverCommand: "/Applications/BookCafe.app/Contents/MacOS/bookcafe-server"
    });
    const expectedPlist = createMacLaunchAgentPlist(agent);
    const baseInput = {
      agent,
      homeDir: "/Users/alice"
    };

    expect(
      createMacLaunchAgentInstallPlan({
        ...baseInput,
        currentPlist: null
      })
    ).toEqual({
      action: "create",
      status: "missing",
      path: "/Users/alice/Library/LaunchAgents/dev.bookcafe.server.plist",
      plist: expectedPlist
    });
    expect(
      createMacLaunchAgentInstallPlan({
        ...baseInput,
        currentPlist: "<plist/>"
      })
    ).toMatchObject({
      action: "update",
      status: "outdated"
    });
    expect(
      createMacLaunchAgentInstallPlan({
        ...baseInput,
        currentPlist: expectedPlist
      })
    ).toMatchObject({
      action: "none",
      status: "current"
    });
  });

  it("plans LaunchAgent removal only when a plist exists", () => {
    const baseInput = {
      label: "dev.bookcafe.server",
      homeDir: "/Users/alice"
    };

    expect(
      createMacLaunchAgentRemovePlan({
        ...baseInput,
        currentPlist: null
      })
    ).toEqual({
      action: "none",
      path: "/Users/alice/Library/LaunchAgents/dev.bookcafe.server.plist"
    });
    expect(
      createMacLaunchAgentRemovePlan({
        ...baseInput,
        currentPlist: "<plist/>"
      })
    ).toEqual({
      action: "remove",
      path: "/Users/alice/Library/LaunchAgents/dev.bookcafe.server.plist"
    });
  });
});

describe("desktop Windows autostart helpers", () => {
  it("reports Windows autostart status from the Tauri plugin enabled flag", () => {
    expect(inspectWindowsAutostart({ enabled: true })).toEqual({
      status: "enabled",
      enabled: true,
      requiredPermissions: tauriAutostartPermissions
    });
    expect(inspectWindowsAutostart({ enabled: false })).toEqual({
      status: "disabled",
      enabled: false,
      requiredPermissions: tauriAutostartPermissions
    });
  });

  it("plans Windows autostart enable, disable, and no-op actions", () => {
    expect(
      createWindowsAutostartPlan({
        currentEnabled: false,
        desiredEnabled: true
      })
    ).toEqual({
      action: "enable",
      status: "disabled",
      desiredEnabled: true,
      requiredPermissions: tauriAutostartPermissions
    });
    expect(
      createWindowsAutostartPlan({
        currentEnabled: true,
        desiredEnabled: false
      })
    ).toEqual({
      action: "disable",
      status: "enabled",
      desiredEnabled: false,
      requiredPermissions: tauriAutostartPermissions
    });
    expect(
      createWindowsAutostartPlan({
        currentEnabled: true,
        desiredEnabled: true
      })
    ).toEqual({
      action: "none",
      status: "enabled",
      desiredEnabled: true,
      requiredPermissions: tauriAutostartPermissions
    });
  });
});

describe("desktop server launch helpers", () => {
  it("creates a Tauri sidecar launch plan for the managed server", () => {
    expect(
      createManagedServerSidecarLaunchPlan({
        sidecarName: "binaries/bookcafe-server",
        config: {
          host: "0.0.0.0",
          port: 4525
        },
        configPath:
          "/Users/alice/Library/Application Support/BookCafe/config.json"
      })
    ).toEqual({
      kind: "tauri-sidecar",
      commandName: "binaries/bookcafe-server",
      args: [
        "--config",
        "/Users/alice/Library/Application Support/BookCafe/config.json"
      ],
      browserUrl: "http://127.0.0.1:4525/",
      healthUrl: "http://127.0.0.1:4525/api/health",
      requiredPermission: {
        identifier: tauriShellSpawnPermission,
        allow: [
          {
            name: "binaries/bookcafe-server",
            sidecar: true,
            args: ["--config", { validator: ".+" }]
          }
        ]
      }
    });
  });

  it("creates a sidecar launch plan without args when config path is default", () => {
    expect(
      createManagedServerSidecarLaunchPlan({
        sidecarName: "binaries/bookcafe-server",
        config: {
          host: "127.0.0.1",
          port: 4510
        }
      })
    ).toMatchObject({
      args: [],
      requiredPermission: {
        allow: [
          {
            args: false
          }
        ]
      }
    });
  });
});

describe("desktop server lifecycle helpers", () => {
  it("classifies lifecycle state from health and managed child state", () => {
    expect(
      inspectManagedServerLifecycle({
        status: createManagedServerStatusFixture("reachable"),
        childPid: null
      })
    ).toMatchObject({
      state: "running",
      reachable: true,
      managedByDesktop: false,
      canStart: false,
      canStop: false
    });
    expect(
      inspectManagedServerLifecycle({
        status: createManagedServerStatusFixture("unreachable"),
        childPid: null
      })
    ).toMatchObject({
      state: "stopped",
      canStart: true,
      canStop: false
    });
    expect(
      inspectManagedServerLifecycle({
        status: createManagedServerStatusFixture("unreachable"),
        childPid: 1234
      })
    ).toMatchObject({
      state: "starting",
      managedByDesktop: true,
      canStart: false,
      canStop: true
    });
    expect(
      inspectManagedServerLifecycle({
        status: createManagedServerStatusFixture("invalid-response"),
        childPid: null
      })
    ).toMatchObject({
      state: "port-conflict",
      canStart: false,
      canStop: false
    });
    expect(
      inspectManagedServerLifecycle({
        status: createManagedServerStatusFixture("invalid-response"),
        childPid: 1234
      })
    ).toMatchObject({
      state: "unhealthy",
      canStart: false,
      canStop: true
    });
    expect(
      inspectManagedServerLifecycle({
        status: createManagedServerStatusFixture("http-error"),
        childPid: null
      })
    ).toMatchObject({
      state: "port-conflict",
      canStart: false,
      canStop: false
    });
  });

  it("plans server start only when the managed server is stopped", () => {
    const launchPlan = createManagedServerSidecarLaunchPlan({
      sidecarName: "binaries/bookcafe-server",
      config: {
        host: "127.0.0.1",
        port: 4510
      }
    });

    expect(
      createManagedServerStartPlan({
        lifecycle: inspectManagedServerLifecycle({
          status: createManagedServerStatusFixture("unreachable"),
          childPid: null
        }),
        launchPlan
      })
    ).toEqual({
      action: "spawn-sidecar",
      reason: "not-running",
      launchPlan
    });
    expect(
      createManagedServerStartPlan({
        lifecycle: inspectManagedServerLifecycle({
          status: createManagedServerStatusFixture("reachable"),
          childPid: null
        }),
        launchPlan
      })
    ).toEqual({
      action: "none",
      reason: "already-running",
      launchPlan: null
    });
    expect(
      createManagedServerStartPlan({
        lifecycle: inspectManagedServerLifecycle({
          status: createManagedServerStatusFixture("invalid-response"),
          childPid: null
        }),
        launchPlan
      })
    ).toEqual({
      action: "none",
      reason: "port-conflict",
      launchPlan: null
    });
    expect(
      createManagedServerStartPlan({
        lifecycle: inspectManagedServerLifecycle({
          status: createManagedServerStatusFixture("unreachable"),
          childPid: 1234
        }),
        launchPlan
      })
    ).toEqual({
      action: "none",
      reason: "already-managed",
      launchPlan: null
    });
  });

  it("plans server stop only for a managed child process", () => {
    expect(
      createManagedServerStopPlan({
        lifecycle: inspectManagedServerLifecycle({
          status: createManagedServerStatusFixture("reachable"),
          childPid: 1234
        })
      })
    ).toEqual({
      action: "kill-child",
      reason: "managed-child",
      childPid: 1234,
      requiredPermission: {
        identifier: tauriShellKillPermission
      }
    });
    expect(
      createManagedServerStopPlan({
        lifecycle: inspectManagedServerLifecycle({
          status: createManagedServerStatusFixture("reachable"),
          childPid: null
        })
      })
    ).toEqual({
      action: "none",
      reason: "no-managed-child",
      childPid: null,
      requiredPermission: null
    });
  });
});

describe("desktop server status helpers", () => {
  it("builds the health URL for the managed server", () => {
    expect(
      getManagedServerHealthUrl({
        host: "0.0.0.0",
        port: 4525
      })
    ).toBe("http://127.0.0.1:4525/api/health");
  });

  it("reports reachable server health", async () => {
    const readStatus = createManagedServerStatusReader(async () =>
      createFetchResponse(200, {
        ok: true,
        service: "bookcafe-server"
      })
    );

    await expect(
      readStatus({
        host: "127.0.0.1",
        port: 4525
      })
    ).resolves.toEqual({
      status: "reachable",
      reachable: true,
      responding: true,
      url: "http://127.0.0.1:4525/api/health",
      statusCode: 200,
      service: "bookcafe-server",
      error: null
    });
  });

  it("reports HTTP responses from a non-BookCafe endpoint as conflicts", async () => {
    const readStatus = createManagedServerStatusReader(async () =>
      createFetchResponse(503, {
        message: "Unavailable"
      })
    );

    await expect(
      readStatus({
        host: "127.0.0.1",
        port: 4525
      })
    ).resolves.toMatchObject({
      status: "http-error",
      reachable: false,
      responding: true,
      statusCode: 503
    });
  });

  it("reports invalid health payloads", async () => {
    const readStatus = createManagedServerStatusReader(async () =>
      createFetchResponse(200, {
        ok: true,
        service: "other-service"
      })
    );

    await expect(
      readStatus({
        host: "127.0.0.1",
        port: 4525
      })
    ).resolves.toMatchObject({
      status: "invalid-response",
      reachable: false,
      statusCode: 200
    });
  });

  it("treats a non-JSON success response as an occupied endpoint", async () => {
    const readStatus = createManagedServerStatusReader(async () =>
      Promise.resolve(
        new Response("<html><body>Another service</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        })
      )
    );

    await expect(
      readStatus({
        host: "127.0.0.1",
        port: 4525
      })
    ).resolves.toMatchObject({
      status: "invalid-response",
      reachable: false,
      responding: true,
      statusCode: 200
    });
  });

  it("reports fetch failures", async () => {
    const readStatus = createManagedServerStatusReader(async () => {
      throw new Error("connection refused");
    });

    await expect(
      readStatus({
        host: "127.0.0.1",
        port: 4525
      })
    ).resolves.toMatchObject({
      status: "unreachable",
      reachable: false,
      responding: false,
      error: "connection refused"
    });
  });
});

/**
 * Creates the subset of Fetch API response shape used by status helpers.
 */
const createFetchResponse = (status: number, payload: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});

/**
 * Creates a managed server status fixture for lifecycle helper tests.
 */
const createManagedServerStatusFixture = (
  status: "reachable" | "unreachable" | "http-error" | "invalid-response"
) => ({
  status,
  reachable: status === "reachable",
  responding: status !== "unreachable",
  url: "http://127.0.0.1:4510/api/health",
  statusCode: status === "unreachable" ? null : 200,
  service: status === "reachable" ? "bookcafe-server" : null,
  error: status === "reachable" ? null : status
});
