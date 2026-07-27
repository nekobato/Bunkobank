/**
 * Behavioral tests for effectful desktop manager operations.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createMacLaunchAgentInstallPlan,
  createMacLaunchAgentRemovePlan,
  createManagedServerSidecarLaunchPlan,
  createWindowsAutostartPlan
} from "./index.js";
import {
  createInitialSetupStatusReader,
  createInitialSetupSubmitter,
  executeMacLaunchAgentInstallPlan,
  executeMacLaunchAgentRemovePlan,
  executeManagedServerStartPlan,
  executeManagedServerStopPlan,
  executeWindowsAutostartPlan,
  isManagedServerApiError,
  openManagedServer,
  readMacLaunchAgentStatus,
  readWindowsAutostartStatus
} from "./operations.js";

describe("desktop initial setup operations", () => {
  it("submits the initial account to the currently running server", async () => {
    const fetchServer = vi.fn(async () =>
      createFetchResponse(201, {
        setupComplete: true
      })
    );
    const submitInitialSetup = createInitialSetupSubmitter(fetchServer);

    await expect(
      submitInitialSetup(
        {
          host: "127.0.0.1",
          port: 4510
        },
        {
          username: " admin ",
          password: "password123"
        }
      )
    ).resolves.toEqual({
      url: "http://127.0.0.1:4510/api/setup/initial-user",
      request: {
        username: "admin",
        password: "password123"
      },
      status: {
        setupComplete: true
      }
    });
    expect(fetchServer).toHaveBeenCalledWith(
      "http://127.0.0.1:4510/api/setup/initial-user",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: "admin",
          password: "password123"
        })
      }
    );
  });

  it("reports an API error message for a rejected setup", async () => {
    const submitInitialSetup = createInitialSetupSubmitter(async () =>
      createFetchResponse(409, {
        message: "Setup is already complete."
      })
    );

    await expect(
      submitInitialSetup(
        {
          host: "127.0.0.1",
          port: 4510
        },
        {
          username: "admin",
          password: "password123"
        }
      )
    ).rejects.toThrow(
      "Initial setup failed (HTTP 409): Setup is already complete."
    );
  });

  it("rejects a successful response with an invalid setup payload", async () => {
    const submitInitialSetup = createInitialSetupSubmitter(async () =>
      createFetchResponse(201, {
        setupComplete: "yes"
      })
    );

    await expect(
      submitInitialSetup(
        {
          host: "127.0.0.1",
          port: 4510
        },
        {
          username: "admin",
          password: "password123"
        }
      )
    ).rejects.toThrow("Initial setup response did not match BookCafe.");
  });

  it("reads and validates setup status from the active server", async () => {
    const fetchServer = vi.fn(async () =>
      createFetchResponse(200, {
        setupComplete: false
      })
    );
    const readSetupStatus = createInitialSetupStatusReader(fetchServer);

    await expect(
      readSetupStatus({
        host: "0.0.0.0",
        port: 4510
      })
    ).resolves.toEqual({
      url: "http://127.0.0.1:4510/api/setup/status",
      status: {
        setupComplete: false
      }
    });
    expect(fetchServer).toHaveBeenCalledWith(
      "http://127.0.0.1:4510/api/setup/status",
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("preserves DATA_UNAVAILABLE metadata from setup status", async () => {
    const readSetupStatus = createInitialSetupStatusReader(async () =>
      createFetchResponse(503, {
        code: "DATA_UNAVAILABLE",
        message: "BookCafe data is unavailable."
      })
    );

    try {
      await readSetupStatus({
        host: "127.0.0.1",
        port: 4510
      });
      throw new Error("Expected setup status to fail.");
    } catch (error) {
      expect(isManagedServerApiError(error)).toBe(true);
      expect(error).toMatchObject({
        status: 503,
        code: "DATA_UNAVAILABLE"
      });
    }
  });
});

describe("desktop managed server operations", () => {
  const launchPlan = createManagedServerSidecarLaunchPlan({
    sidecarName: "binaries/bookcafe-server",
    config: {
      host: "127.0.0.1",
      port: 4510
    }
  });

  it("spawns a sidecar only for an executable start plan", async () => {
    const spawnSidecar = vi.fn(async () => ({ pid: 1234 }));

    await expect(
      executeManagedServerStartPlan(
        {
          action: "spawn-sidecar",
          reason: "not-running",
          launchPlan
        },
        spawnSidecar
      )
    ).resolves.toEqual({
      action: "spawn-sidecar",
      executed: true,
      childPid: 1234
    });
    expect(spawnSidecar).toHaveBeenCalledWith(launchPlan);

    spawnSidecar.mockClear();

    await expect(
      executeManagedServerStartPlan(
        {
          action: "none",
          reason: "already-running",
          launchPlan: null
        },
        spawnSidecar
      )
    ).resolves.toEqual({
      action: "none",
      executed: false,
      childPid: null
    });
    expect(spawnSidecar).not.toHaveBeenCalled();
  });

  it("rejects an invalid sidecar child PID", async () => {
    await expect(
      executeManagedServerStartPlan(
        {
          action: "spawn-sidecar",
          reason: "not-running",
          launchPlan
        },
        async () => ({ pid: 0 })
      )
    ).rejects.toThrow("Managed server child PID must be a positive integer.");
  });

  it("rejects an inconsistent executable start plan", async () => {
    const spawnSidecar = vi.fn(async () => ({ pid: 1234 }));

    await expect(
      executeManagedServerStartPlan(
        {
          action: "spawn-sidecar",
          reason: "not-running",
          launchPlan: null
        },
        spawnSidecar
      )
    ).rejects.toThrow("Managed server start plan requires a launch plan.");
    expect(spawnSidecar).not.toHaveBeenCalled();
  });

  it("kills only a child selected by an executable stop plan", async () => {
    const killChild = vi.fn(async () => undefined);

    await expect(
      executeManagedServerStopPlan(
        {
          action: "kill-child",
          reason: "managed-child",
          childPid: 1234,
          requiredPermission: {
            identifier: "shell:allow-kill"
          }
        },
        killChild
      )
    ).resolves.toEqual({
      action: "kill-child",
      executed: true,
      childPid: 1234
    });
    expect(killChild).toHaveBeenCalledWith(1234);

    killChild.mockClear();

    await expect(
      executeManagedServerStopPlan(
        {
          action: "none",
          reason: "no-managed-child",
          childPid: null,
          requiredPermission: null
        },
        killChild
      )
    ).resolves.toEqual({
      action: "none",
      executed: false,
      childPid: null
    });
    expect(killChild).not.toHaveBeenCalled();
  });

  it("rejects an invalid child PID before invoking the terminator", async () => {
    const killChild = vi.fn(async () => undefined);

    await expect(
      executeManagedServerStopPlan(
        {
          action: "kill-child",
          reason: "managed-child",
          childPid: -1,
          requiredPermission: {
            identifier: "shell:allow-kill"
          }
        },
        killChild
      )
    ).rejects.toThrow("Managed server child PID must be a positive integer.");
    expect(killChild).not.toHaveBeenCalled();
  });

  it("opens the normalized browser URL through an injected opener", async () => {
    const openUrl = vi.fn(async () => undefined);

    await expect(
      openManagedServer(
        {
          host: "0.0.0.0",
          port: 4525
        },
        openUrl
      )
    ).resolves.toBe("http://127.0.0.1:4525/");
    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:4525/");
  });
});

describe("desktop macOS LaunchAgent operations", () => {
  const agent = {
    label: "dev.bookcafe.server",
    programArguments: [
      "/Applications/BookCafe.app/Contents/MacOS/bookcafe-server"
    ],
    runAtLoad: true,
    keepAlive: true
  };

  it.each([
    [null, "create"],
    ["<plist/>", "update"]
  ] as const)(
    "executes a %s plist state as %s",
    async (currentPlist, action) => {
      const plan = createMacLaunchAgentInstallPlan({
        agent,
        homeDir: "/Users/alice",
        currentPlist
      });
      const writePlist = vi.fn(async () => undefined);

      await expect(
        executeMacLaunchAgentInstallPlan(plan, writePlist)
      ).resolves.toEqual({
        action,
        executed: true
      });
      expect(writePlist).toHaveBeenCalledWith(plan.path, plan.plist);
    }
  );

  it("reads the current plist before inspecting LaunchAgent status", async () => {
    const readPlist = vi.fn(async () => "<plist/>");

    await expect(
      readMacLaunchAgentStatus(
        {
          agent,
          homeDir: "/Users/alice"
        },
        readPlist
      )
    ).resolves.toMatchObject({
      status: "outdated",
      path: "/Users/alice/Library/LaunchAgents/dev.bookcafe.server.plist",
      currentPlist: "<plist/>"
    });
    expect(readPlist).toHaveBeenCalledWith(
      "/Users/alice/Library/LaunchAgents/dev.bookcafe.server.plist"
    );
  });

  it("skips a current LaunchAgent plist", async () => {
    const initialPlan = createMacLaunchAgentInstallPlan({
      agent,
      homeDir: "/Users/alice",
      currentPlist: null
    });
    const writePlist = vi.fn(async () => undefined);

    await expect(
      executeMacLaunchAgentInstallPlan(
        {
          ...initialPlan,
          action: "none",
          status: "current"
        },
        writePlist
      )
    ).resolves.toEqual({
      action: "none",
      executed: false
    });
    expect(writePlist).not.toHaveBeenCalled();
  });

  it("removes only an existing LaunchAgent plist", async () => {
    const removePlist = vi.fn(async () => undefined);
    const removePlan = createMacLaunchAgentRemovePlan({
      label: agent.label,
      homeDir: "/Users/alice",
      currentPlist: "<plist/>"
    });

    await expect(
      executeMacLaunchAgentRemovePlan(removePlan, removePlist)
    ).resolves.toEqual({
      action: "remove",
      executed: true
    });
    expect(removePlist).toHaveBeenCalledWith(removePlan.path);

    removePlist.mockClear();

    await expect(
      executeMacLaunchAgentRemovePlan(
        {
          action: "none",
          path: removePlan.path
        },
        removePlist
      )
    ).resolves.toEqual({
      action: "none",
      executed: false
    });
    expect(removePlist).not.toHaveBeenCalled();
  });
});

describe("desktop Windows autostart operations", () => {
  it("reads current autostart state through an injected plugin effect", async () => {
    const isEnabled = vi.fn(async () => true);

    await expect(readWindowsAutostartStatus(isEnabled)).resolves.toEqual({
      status: "enabled",
      enabled: true,
      requiredPermissions: [
        "autostart:allow-enable",
        "autostart:allow-disable",
        "autostart:allow-is-enabled"
      ]
    });
    expect(isEnabled).toHaveBeenCalledTimes(1);
  });

  it.each([
    [false, true, "enable"],
    [true, false, "disable"]
  ] as const)(
    "changes autostart from %s to %s with %s",
    async (currentEnabled, desiredEnabled, action) => {
      const enable = vi.fn(async () => undefined);
      const disable = vi.fn(async () => undefined);

      await expect(
        executeWindowsAutostartPlan(
          createWindowsAutostartPlan({
            currentEnabled,
            desiredEnabled
          }),
          { enable, disable }
        )
      ).resolves.toEqual({
        action,
        executed: true
      });
      expect(enable).toHaveBeenCalledTimes(action === "enable" ? 1 : 0);
      expect(disable).toHaveBeenCalledTimes(action === "disable" ? 1 : 0);
    }
  );

  it("skips an already matching autostart state", async () => {
    const enable = vi.fn(async () => undefined);
    const disable = vi.fn(async () => undefined);

    await expect(
      executeWindowsAutostartPlan(
        createWindowsAutostartPlan({
          currentEnabled: true,
          desiredEnabled: true
        }),
        { enable, disable }
      )
    ).resolves.toEqual({
      action: "none",
      executed: false
    });
    expect(enable).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });
});

/**
 * Creates the subset of Fetch API response shape used by desktop operations.
 */
const createFetchResponse = (status: number, payload: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});
