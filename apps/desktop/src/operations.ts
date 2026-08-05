/**
 * Effectful desktop manager operations built from the pure plans in index.ts.
 */

import type { AppConfig } from "@bunkobank/config/shared";
import {
  apiErrorResponseSchema,
  setupStatusSchema,
  type ApiErrorCode,
  type InitialSetupRequest,
  type SetupStatusResponse
} from "@bunkobank/contracts";

import {
  createInitialSetupRequest,
  createMacLaunchAgentPath,
  createManagedServerUrl,
  inspectMacLaunchAgent,
  inspectWindowsAutostart,
  type MacLaunchAgentInstallAction,
  type MacLaunchAgentInstallPlan,
  type MacLaunchAgentInspectionInput,
  type MacLaunchAgentRemoveAction,
  type MacLaunchAgentRemovePlan,
  type MacLaunchAgentStatus,
  type ManagedServerFetch,
  type ManagedServerSidecarLaunchPlan,
  type ManagedServerStartAction,
  type ManagedServerStartPlan,
  type ManagedServerStopAction,
  type ManagedServerStopPlan,
  type SetupDraft,
  type WindowsAutostartAction,
  type WindowsAutostartPlan,
  type WindowsAutostartStatus
} from "./index.js";

type ManagedServerResponse = Awaited<ReturnType<ManagedServerFetch>>;

export interface InitialSetupSubmission {
  url: string;
  request: InitialSetupRequest;
  status: SetupStatusResponse;
}

export interface InitialSetupStatusRead {
  url: string;
  status: SetupStatusResponse;
}

export type InitialSetupSubmitter = (
  activeServerConfig: Pick<AppConfig, "host" | "port">,
  draft: Partial<SetupDraft>
) => Promise<InitialSetupSubmission>;

export type InitialSetupStatusReader = (
  activeServerConfig: Pick<AppConfig, "host" | "port">
) => Promise<InitialSetupStatusRead>;

export type ManagedServerApiError = Error & {
  status: number;
  code: ApiErrorCode | null;
};

export interface ManagedServerChild {
  pid: number;
}

export type SpawnManagedServerSidecar = (
  launchPlan: ManagedServerSidecarLaunchPlan
) => Promise<ManagedServerChild>;

export type KillManagedServerChild = (pid: number) => Promise<void>;

export type OpenExternalUrl = (url: string) => Promise<void>;

export type WriteMacLaunchAgentPlist = (
  path: string,
  plist: string
) => Promise<void>;

export type RemoveMacLaunchAgentPlist = (path: string) => Promise<void>;

export type ReadMacLaunchAgentPlist = (path: string) => Promise<string | null>;

export type ReadWindowsAutostartEnabled = () => Promise<boolean>;

export interface WindowsAutostartEffects {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

export interface ManagedServerStartExecution {
  action: ManagedServerStartAction;
  executed: boolean;
  childPid: number | null;
}

export interface ManagedServerStopExecution {
  action: ManagedServerStopAction;
  executed: boolean;
  childPid: number | null;
}

export interface MacLaunchAgentExecution {
  action: MacLaunchAgentInstallAction | MacLaunchAgentRemoveAction;
  executed: boolean;
}

export interface WindowsAutostartExecution {
  action: WindowsAutostartAction;
  executed: boolean;
}

/**
 * Creates a submitter for the Hono initial setup endpoint.
 *
 * The active server config locates the process that is accepting setup while
 * the draft describes the config that process should persist.
 */
export const createInitialSetupSubmitter =
  (fetchServer: ManagedServerFetch = fetch): InitialSetupSubmitter =>
  async (activeServerConfig, draft) => {
    const url = createManagedServerUrl(
      activeServerConfig,
      "/api/setup/initial-user"
    );
    const request = createInitialSetupRequest(draft);
    const response = await fetchServer(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request)
    });
    const payload = await readResponsePayload(response);

    if (!response.ok) {
      throw createManagedServerApiError(
        "Initial setup",
        response.status,
        payload
      );
    }

    const parsed = setupStatusSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error("Initial setup response did not match Bunkobank.");
    }

    return {
      url,
      request,
      status: parsed.data
    };
  };

/**
 * Creates a validated reader for the Hono setup status endpoint.
 */
export const createInitialSetupStatusReader =
  (fetchServer: ManagedServerFetch = fetch): InitialSetupStatusReader =>
  async (activeServerConfig) => {
    const url = createManagedServerUrl(activeServerConfig, "/api/setup/status");
    const response = await fetchServer(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await readResponsePayload(response);

    if (!response.ok) {
      throw createManagedServerApiError(
        "Setup status",
        response.status,
        payload
      );
    }

    const parsed = setupStatusSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error("Setup status response did not match Bunkobank.");
    }

    return {
      url,
      status: parsed.data
    };
  };

/**
 * Executes a managed server start plan through an injected sidecar spawner.
 */
export const executeManagedServerStartPlan = async (
  plan: ManagedServerStartPlan,
  spawnSidecar: SpawnManagedServerSidecar
): Promise<ManagedServerStartExecution> => {
  if (plan.action === "none") {
    return {
      action: plan.action,
      executed: false,
      childPid: null
    };
  }

  if (plan.launchPlan === null) {
    throw new Error("Managed server start plan requires a launch plan.");
  }

  const child = await spawnSidecar(plan.launchPlan);

  assertManagedChildPid(child.pid);

  return {
    action: plan.action,
    executed: true,
    childPid: child.pid
  };
};

/**
 * Executes a managed server stop plan through an injected child terminator.
 */
export const executeManagedServerStopPlan = async (
  plan: ManagedServerStopPlan,
  killChild: KillManagedServerChild
): Promise<ManagedServerStopExecution> => {
  if (plan.action === "none") {
    return {
      action: plan.action,
      executed: false,
      childPid: null
    };
  }

  assertManagedChildPid(plan.childPid);

  await killChild(plan.childPid);

  return {
    action: plan.action,
    executed: true,
    childPid: plan.childPid
  };
};

/**
 * Opens the managed server UI through an injected external URL opener.
 */
export const openManagedServer = async (
  config: Pick<AppConfig, "host" | "port">,
  openUrl: OpenExternalUrl
): Promise<string> => {
  const url = createManagedServerUrl(config);

  await openUrl(url);

  return url;
};

/**
 * Reads and inspects the current macOS LaunchAgent plist through an injected
 * filesystem adapter.
 */
export const readMacLaunchAgentStatus = async (
  input: Omit<MacLaunchAgentInspectionInput, "currentPlist">,
  readPlist: ReadMacLaunchAgentPlist
): Promise<MacLaunchAgentStatus> => {
  const path = createMacLaunchAgentPath(input.agent.label, input.homeDir);
  const currentPlist = await readPlist(path);

  return inspectMacLaunchAgent({
    ...input,
    currentPlist
  });
};

/**
 * Executes a LaunchAgent create or update plan through an injected plist writer.
 */
export const executeMacLaunchAgentInstallPlan = async (
  plan: MacLaunchAgentInstallPlan,
  writePlist: WriteMacLaunchAgentPlist
): Promise<MacLaunchAgentExecution> => {
  if (plan.action === "none") {
    return {
      action: plan.action,
      executed: false
    };
  }

  await writePlist(plan.path, plan.plist);

  return {
    action: plan.action,
    executed: true
  };
};

/**
 * Executes a LaunchAgent removal plan through an injected plist remover.
 */
export const executeMacLaunchAgentRemovePlan = async (
  plan: MacLaunchAgentRemovePlan,
  removePlist: RemoveMacLaunchAgentPlist
): Promise<MacLaunchAgentExecution> => {
  if (plan.action === "none") {
    return {
      action: plan.action,
      executed: false
    };
  }

  await removePlist(plan.path);

  return {
    action: plan.action,
    executed: true
  };
};

/**
 * Executes a Windows login autostart plan through injected plugin effects.
 */
export const executeWindowsAutostartPlan = async (
  plan: WindowsAutostartPlan,
  effects: WindowsAutostartEffects
): Promise<WindowsAutostartExecution> => {
  if (plan.action === "none") {
    return {
      action: plan.action,
      executed: false
    };
  }

  await effects[plan.action]();

  return {
    action: plan.action,
    executed: true
  };
};

/**
 * Reads the Windows login autostart state through an injected plugin effect.
 */
export const readWindowsAutostartStatus = async (
  isEnabled: ReadWindowsAutostartEnabled
): Promise<WindowsAutostartStatus> =>
  inspectWindowsAutostart({
    enabled: await isEnabled()
  });

/**
 * Reads a response body without obscuring its HTTP status on invalid JSON.
 */
const readResponsePayload = async (
  response: ManagedServerResponse
): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * Extracts a server-provided error message from an API response payload.
 */
const getApiErrorMessage = (payload: unknown): string | null => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("message" in payload) ||
    typeof payload.message !== "string"
  ) {
    return null;
  }

  const message = payload.message.trim();

  return message || null;
};

/**
 * Creates a normal Error carrying stable HTTP and Bunkobank API identifiers.
 */
const createManagedServerApiError = (
  operation: string,
  status: number,
  payload: unknown
): ManagedServerApiError => {
  const parsed = apiErrorResponseSchema.safeParse(payload);
  const message = getApiErrorMessage(payload);
  const error = new Error(
    message
      ? `${operation} failed (HTTP ${status}): ${message}`
      : `${operation} failed (HTTP ${status}).`
  ) as ManagedServerApiError;
  error.status = status;
  error.code = parsed.success ? parsed.data.code : null;
  return error;
};

/**
 * Returns whether an unknown failure carries Bunkobank API error metadata.
 */
export const isManagedServerApiError = (
  error: unknown
): error is ManagedServerApiError =>
  error instanceof Error &&
  "status" in error &&
  typeof error.status === "number" &&
  "code" in error &&
  (typeof error.code === "string" || error.code === null);

/**
 * Rejects unknown or unsafe process identifiers before a child operation.
 */
const assertManagedChildPid: (pid: number | null) => asserts pid is number = (
  pid
) => {
  if (pid === null || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("Managed server child PID must be a positive integer.");
  }
};
