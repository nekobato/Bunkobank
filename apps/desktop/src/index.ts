/**
 * Shared planning surface for the future Tauri manager application.
 */

import { createServerUrl, type AppConfig } from "@bunkobank/config/shared";
import { healthResponseSchema } from "@bunkobank/contracts";

import type { InitialSetupRequest } from "@bunkobank/contracts";

export interface SetupDraft {
  username: string;
  password: string;
}

export type ManagedServerStatusKind =
  "reachable" | "unreachable" | "http-error" | "invalid-response";

export interface ManagedServerStatus {
  status: ManagedServerStatusKind;
  reachable: boolean;
  responding: boolean;
  url: string;
  statusCode: number | null;
  service: string | null;
  error: string | null;
}

export type ManagedServerFetch = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

type ManagedServerResponse = Awaited<ReturnType<ManagedServerFetch>>;

export interface MacLaunchAgent {
  label: string;
  programArguments: string[];
  environmentVariables?: Record<string, string>;
  workingDirectory?: string;
  runAtLoad: boolean;
  keepAlive: boolean;
  standardOutPath?: string;
  standardErrorPath?: string;
}

export interface BunkobankServerLaunchAgentOptions {
  serverCommand: string;
  configPath?: string;
  label?: string;
  logDir?: string;
  workingDirectory?: string;
}

export type MacLaunchAgentStatusKind = "missing" | "current" | "outdated";

export type MacLaunchAgentInstallAction = "create" | "update" | "none";

export type MacLaunchAgentRemoveAction = "remove" | "none";

export type WindowsAutostartStatusKind = "enabled" | "disabled";

export type WindowsAutostartAction = "enable" | "disable" | "none";

export type ManagedServerLaunchKind = "tauri-sidecar";

export type ManagedServerLifecycleState =
  "stopped" | "starting" | "running" | "port-conflict" | "unhealthy";

export type ManagedServerStartAction = "spawn-sidecar" | "none";

export type ManagedServerStopAction = "kill-child" | "none";

export type TauriShellPermissionArgument = string | { validator: string };

export const tauriAutostartPermissions = [
  "autostart:allow-enable",
  "autostart:allow-disable",
  "autostart:allow-is-enabled"
] as const;

export const tauriShellSpawnPermission = "shell:allow-spawn";

export const tauriShellKillPermission = "shell:allow-kill";

export interface TauriShellSidecarPermission {
  identifier: typeof tauriShellSpawnPermission;
  allow: [
    {
      name: string;
      sidecar: true;
      args: false | TauriShellPermissionArgument[];
    }
  ];
}

export interface TauriShellKillPermission {
  identifier: typeof tauriShellKillPermission;
}

export interface MacLaunchAgentInspectionInput {
  agent: MacLaunchAgent;
  homeDir: string;
  currentPlist: string | null;
}

export interface MacLaunchAgentStatus {
  status: MacLaunchAgentStatusKind;
  path: string;
  expectedPlist: string;
  currentPlist: string | null;
}

export interface MacLaunchAgentInstallPlan {
  action: MacLaunchAgentInstallAction;
  status: MacLaunchAgentStatusKind;
  path: string;
  plist: string;
}

export interface MacLaunchAgentRemovePlanInput {
  label: string;
  homeDir: string;
  currentPlist: string | null;
}

export interface MacLaunchAgentRemovePlan {
  action: MacLaunchAgentRemoveAction;
  path: string;
}

export interface WindowsAutostartInspectionInput {
  enabled: boolean;
}

export interface WindowsAutostartStatus {
  status: WindowsAutostartStatusKind;
  enabled: boolean;
  requiredPermissions: typeof tauriAutostartPermissions;
}

export interface WindowsAutostartPlanInput {
  currentEnabled: boolean;
  desiredEnabled: boolean;
}

export interface WindowsAutostartPlan {
  action: WindowsAutostartAction;
  status: WindowsAutostartStatusKind;
  desiredEnabled: boolean;
  requiredPermissions: typeof tauriAutostartPermissions;
}

export interface ManagedServerSidecarLaunchPlanInput {
  sidecarName: string;
  config: Pick<AppConfig, "host" | "port">;
  configPath?: string;
}

export interface ManagedServerSidecarLaunchPlan {
  kind: ManagedServerLaunchKind;
  commandName: string;
  args: string[];
  browserUrl: string;
  healthUrl: string;
  requiredPermission: TauriShellSidecarPermission;
}

export interface ManagedServerLifecycleInput {
  status: ManagedServerStatus;
  childPid: number | null;
}

export interface ManagedServerLifecycleStatus {
  state: ManagedServerLifecycleState;
  reachable: boolean;
  managedByDesktop: boolean;
  childPid: number | null;
  canStart: boolean;
  canStop: boolean;
  status: ManagedServerStatusKind;
}

export interface ManagedServerStartPlanInput {
  lifecycle: ManagedServerLifecycleStatus;
  launchPlan: ManagedServerSidecarLaunchPlan;
}

export interface ManagedServerStartPlan {
  action: ManagedServerStartAction;
  reason:
    "not-running" | "already-running" | "already-managed" | "port-conflict";
  launchPlan: ManagedServerSidecarLaunchPlan | null;
}

export interface ManagedServerStopPlanInput {
  lifecycle: ManagedServerLifecycleStatus;
}

export interface ManagedServerStopPlan {
  action: ManagedServerStopAction;
  reason: "managed-child" | "no-managed-child";
  childPid: number | null;
  requiredPermission: TauriShellKillPermission | null;
}

/**
 * Normalizes the server port entered in the desktop setup flow.
 */
export const normalizePort = (port: number): number =>
  Number.isInteger(port) && port > 0 && port <= 65535 ? port : 4510;

/**
 * Creates the default setup draft for the desktop manager setup form.
 */
export const createDefaultSetupDraft = (): SetupDraft => ({
  username: "",
  password: ""
});

/**
 * Normalizes a setup draft before it is sent to the server setup API.
 */
export const normalizeSetupDraft = (draft: Partial<SetupDraft>): SetupDraft => {
  const defaults = createDefaultSetupDraft();

  return {
    username: (draft.username ?? defaults.username).trim(),
    password: draft.password ?? defaults.password
  };
};

/**
 * Converts a desktop setup draft into the Hono initial setup request body.
 */
export const createInitialSetupRequest = (
  draft: Partial<SetupDraft>
): InitialSetupRequest => {
  const normalized = normalizeSetupDraft(draft);

  return {
    username: normalized.username,
    password: normalized.password
  };
};

/**
 * Builds a browser URL for the configured server managed by the desktop app.
 */
export const createManagedServerUrl = (
  config: Pick<AppConfig, "host" | "port">,
  path = "/"
): string => createServerUrl(config, path);

/**
 * Builds the managed server health endpoint URL.
 */
export const getManagedServerHealthUrl = (
  config: Pick<AppConfig, "host" | "port">
): string => createManagedServerUrl(config, "/api/health");

/**
 * Creates a status reader for the managed server health endpoint.
 */
export const createManagedServerStatusReader =
  (
    fetchServer: ManagedServerFetch = fetch
  ): ((
    config: Pick<AppConfig, "host" | "port">
  ) => Promise<ManagedServerStatus>) =>
  async (config) => {
    const url = getManagedServerHealthUrl(config);
    let response: ManagedServerResponse;

    try {
      response = await fetchServer(url, {
        headers: {
          Accept: "application/json"
        },
        method: "GET"
      });
    } catch (error) {
      return createManagedServerStatus({
        status: "unreachable",
        url,
        error: error instanceof Error ? error.message : "Health check failed."
      });
    }

    if (!response.ok) {
      return createManagedServerStatus({
        status: "http-error",
        url,
        statusCode: response.status,
        error: `Health check returned HTTP ${response.status}.`
      });
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      return createManagedServerStatus({
        status: "invalid-response",
        url,
        statusCode: response.status,
        error: "Health check response was not valid JSON."
      });
    }

    const parsed = healthResponseSchema.safeParse(payload);

    if (!parsed.success) {
      return createManagedServerStatus({
        status: "invalid-response",
        url,
        statusCode: response.status,
        error: "Health check response did not match Bunkobank."
      });
    }

    return createManagedServerStatus({
      status: "reachable",
      url,
      statusCode: response.status,
      service: parsed.data.service
    });
  };

/**
 * Reads the current managed server status using the global fetch implementation.
 */
export const readManagedServerStatus = createManagedServerStatusReader();

/**
 * Builds the expected per-user LaunchAgent plist path for a label.
 */
export const createMacLaunchAgentPath = (
  label: string,
  homeDir: string
): string =>
  joinPosixPath(homeDir, "Library", "LaunchAgents", `${label}.plist`);

/**
 * Creates the LaunchAgent model for the Bunkobank server sidecar.
 */
export const createBunkobankServerLaunchAgent = (
  options: BunkobankServerLaunchAgentOptions
): MacLaunchAgent => ({
  label: options.label ?? "dev.bunkobank.server",
  programArguments: [options.serverCommand],
  ...(options.configPath
    ? {
        environmentVariables: {
          BUNKOBANK_CONFIG: options.configPath
        }
      }
    : {}),
  ...(options.workingDirectory
    ? {
        workingDirectory: options.workingDirectory
      }
    : {}),
  runAtLoad: true,
  keepAlive: true,
  ...(options.logDir
    ? {
        standardOutPath: joinPosixPath(options.logDir, "server.out.log"),
        standardErrorPath: joinPosixPath(options.logDir, "server.err.log")
      }
    : {})
});

/**
 * Serializes a macOS LaunchAgent model into a plist XML document.
 */
export const createMacLaunchAgentPlist = (agent: MacLaunchAgent): string => {
  assertMacLaunchAgent(agent);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    plistKey("Label"),
    plistString(agent.label),
    plistKey("ProgramArguments"),
    plistStringArray(agent.programArguments),
    plistKey("RunAtLoad"),
    plistBoolean(agent.runAtLoad),
    plistKey("KeepAlive"),
    plistBoolean(agent.keepAlive),
    ...optionalPlistString("WorkingDirectory", agent.workingDirectory),
    ...optionalPlistString("StandardOutPath", agent.standardOutPath),
    ...optionalPlistString("StandardErrorPath", agent.standardErrorPath),
    ...optionalPlistStringDictionary(
      "EnvironmentVariables",
      agent.environmentVariables
    ),
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
};

/**
 * Compares the current LaunchAgent plist with the expected Bunkobank model.
 */
export const inspectMacLaunchAgent = (
  input: MacLaunchAgentInspectionInput
): MacLaunchAgentStatus => {
  const expectedPlist = createMacLaunchAgentPlist(input.agent);
  const currentPlist = input.currentPlist;
  const status =
    currentPlist === null
      ? "missing"
      : currentPlist === expectedPlist
        ? "current"
        : "outdated";

  return {
    status,
    path: createMacLaunchAgentPath(input.agent.label, input.homeDir),
    expectedPlist,
    currentPlist
  };
};

/**
 * Plans the filesystem write needed to create or update the LaunchAgent plist.
 */
export const createMacLaunchAgentInstallPlan = (
  input: MacLaunchAgentInspectionInput
): MacLaunchAgentInstallPlan => {
  const status = inspectMacLaunchAgent(input);
  const action =
    status.status === "missing"
      ? "create"
      : status.status === "outdated"
        ? "update"
        : "none";

  return {
    action,
    status: status.status,
    path: status.path,
    plist: status.expectedPlist
  };
};

/**
 * Plans removal of an existing LaunchAgent plist without touching the file.
 */
export const createMacLaunchAgentRemovePlan = (
  input: MacLaunchAgentRemovePlanInput
): MacLaunchAgentRemovePlan => ({
  action: input.currentPlist === null ? "none" : "remove",
  path: createMacLaunchAgentPath(input.label, input.homeDir)
});

/**
 * Converts the Tauri autostart plugin enabled flag into a desktop status.
 */
export const inspectWindowsAutostart = (
  input: WindowsAutostartInspectionInput
): WindowsAutostartStatus => ({
  status: input.enabled ? "enabled" : "disabled",
  enabled: input.enabled,
  requiredPermissions: tauriAutostartPermissions
});

/**
 * Plans the Tauri autostart plugin call needed for Windows login startup.
 */
export const createWindowsAutostartPlan = (
  input: WindowsAutostartPlanInput
): WindowsAutostartPlan => {
  const status = inspectWindowsAutostart({
    enabled: input.currentEnabled
  });
  const action =
    input.currentEnabled === input.desiredEnabled
      ? "none"
      : input.desiredEnabled
        ? "enable"
        : "disable";

  return {
    action,
    status: status.status,
    desiredEnabled: input.desiredEnabled,
    requiredPermissions: tauriAutostartPermissions
  };
};

/**
 * Creates the Tauri sidecar launch plan for the managed Hono server.
 */
export const createManagedServerSidecarLaunchPlan = (
  input: ManagedServerSidecarLaunchPlanInput
): ManagedServerSidecarLaunchPlan => {
  const args = input.configPath ? ["--config", input.configPath] : [];

  return {
    kind: "tauri-sidecar",
    commandName: input.sidecarName,
    args,
    browserUrl: createManagedServerUrl(input.config, "/"),
    healthUrl: getManagedServerHealthUrl(input.config),
    requiredPermission: createTauriSidecarSpawnPermission({
      sidecarName: input.sidecarName,
      configPathEnabled: Boolean(input.configPath)
    })
  };
};

/**
 * Combines server health and sidecar child state into a desktop lifecycle view.
 */
export const inspectManagedServerLifecycle = (
  input: ManagedServerLifecycleInput
): ManagedServerLifecycleStatus => {
  const managedByDesktop = input.childPid !== null;
  const state = getManagedServerLifecycleState(input.status, managedByDesktop);

  return {
    state,
    reachable: input.status.reachable,
    managedByDesktop,
    childPid: input.childPid,
    canStart: state === "stopped",
    canStop: managedByDesktop,
    status: input.status.status
  };
};

/**
 * Plans a start operation without spawning a process.
 */
export const createManagedServerStartPlan = (
  input: ManagedServerStartPlanInput
): ManagedServerStartPlan => {
  if (input.lifecycle.state === "running") {
    return {
      action: "none",
      reason: "already-running",
      launchPlan: null
    };
  }

  if (input.lifecycle.state === "port-conflict") {
    return {
      action: "none",
      reason: "port-conflict",
      launchPlan: null
    };
  }

  if (!input.lifecycle.canStart) {
    return {
      action: "none",
      reason: "already-managed",
      launchPlan: null
    };
  }

  return {
    action: "spawn-sidecar",
    reason: "not-running",
    launchPlan: input.launchPlan
  };
};

/**
 * Plans a stop operation without killing a process.
 */
export const createManagedServerStopPlan = (
  input: ManagedServerStopPlanInput
): ManagedServerStopPlan => {
  if (input.lifecycle.childPid === null) {
    return {
      action: "none",
      reason: "no-managed-child",
      childPid: null,
      requiredPermission: null
    };
  }

  return {
    action: "kill-child",
    reason: "managed-child",
    childPid: input.lifecycle.childPid,
    requiredPermission: {
      identifier: tauriShellKillPermission
    }
  };
};

/**
 * Builds a normalized managed server status object.
 */
const createManagedServerStatus = ({
  status,
  url,
  statusCode = null,
  service = null,
  error = null
}: {
  status: ManagedServerStatusKind;
  url: string;
  statusCode?: number | null;
  service?: string | null;
  error?: string | null;
}): ManagedServerStatus => ({
  status,
  reachable: status === "reachable",
  responding: status !== "unreachable",
  url,
  statusCode,
  service,
  error
});

/**
 * Throws when a LaunchAgent model lacks mandatory fields.
 */
const assertMacLaunchAgent = (agent: MacLaunchAgent): void => {
  if (!agent.label.trim()) {
    throw new Error("LaunchAgent label is required.");
  }

  if (agent.programArguments.length < 1) {
    throw new Error("LaunchAgent ProgramArguments are required.");
  }
};

/**
 * Creates the Tauri shell capability needed to spawn the server sidecar.
 */
const createTauriSidecarSpawnPermission = ({
  sidecarName,
  configPathEnabled
}: {
  sidecarName: string;
  configPathEnabled: boolean;
}): TauriShellSidecarPermission => ({
  identifier: tauriShellSpawnPermission,
  allow: [
    {
      name: sidecarName,
      sidecar: true,
      args: configPathEnabled ? ["--config", { validator: ".+" }] : false
    }
  ]
});

/**
 * Classifies the managed server state for desktop controls.
 */
const getManagedServerLifecycleState = (
  status: ManagedServerStatus,
  managedByDesktop: boolean
): ManagedServerLifecycleState => {
  if (status.status === "reachable") {
    return "running";
  }

  if (status.status === "invalid-response" || status.status === "http-error") {
    return managedByDesktop ? "unhealthy" : "port-conflict";
  }

  return managedByDesktop ? "starting" : "stopped";
};

/**
 * Joins POSIX path segments without relying on Node.js APIs in the Tauri
 * WebView bundle.
 */
const joinPosixPath = (...segments: string[]): string => {
  const absolute = segments[0]?.startsWith("/") ?? false;
  const pathSegments = segments
    .flatMap((segment) => segment.split("/"))
    .filter((segment) => segment.length > 0 && segment !== ".")
    .reduce<string[]>((result, segment) => {
      if (segment === "..") {
        if (result.length > 0 && result.at(-1) !== "..") {
          return result.slice(0, -1);
        }

        return absolute ? result : [...result, segment];
      }

      return [...result, segment];
    }, []);
  const joined = pathSegments.join("/");

  if (absolute) {
    return joined ? `/${joined}` : "/";
  }

  return joined || ".";
};

/**
 * Serializes a plist key line.
 */
const plistKey = (key: string): string => `  <key>${escapeXml(key)}</key>`;

/**
 * Serializes a plist string line.
 */
const plistString = (value: string): string =>
  `  <string>${escapeXml(value)}</string>`;

/**
 * Serializes a plist boolean line.
 */
const plistBoolean = (value: boolean): string =>
  value ? "  <true/>" : "  <false/>";

/**
 * Serializes a plist string array.
 */
const plistStringArray = (values: string[]): string =>
  [
    "  <array>",
    ...values.map((value) => `    <string>${escapeXml(value)}</string>`),
    "  </array>"
  ].join("\n");

/**
 * Serializes an optional plist string entry.
 */
const optionalPlistString = (
  key: string,
  value: string | undefined
): string[] => (value ? [plistKey(key), plistString(value)] : []);

/**
 * Serializes an optional plist dictionary of string values.
 */
const optionalPlistStringDictionary = (
  key: string,
  dictionary: Record<string, string> | undefined
): string[] => {
  const entries = Object.entries(dictionary ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  if (entries.length < 1) {
    return [];
  }

  return [
    plistKey(key),
    "  <dict>",
    ...entries.flatMap(([entryKey, entryValue]) => [
      `    <key>${escapeXml(entryKey)}</key>`,
      `    <string>${escapeXml(entryValue)}</string>`
    ]),
    "  </dict>"
  ];
};

/**
 * Escapes XML text for plist string and key nodes.
 */
const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
