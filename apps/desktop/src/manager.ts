/**
 * Functional state machine coordinating the BookCafe desktop manager.
 */

import type { AppConfig } from "@bookcafe/config/shared";
import {
  initialSetupRequestSchema,
  type ApiErrorCode,
  type InitialSetupRequest
} from "@bookcafe/contracts";

import {
  createBookCafeServerLaunchAgent,
  createDefaultSetupDraft,
  createMacLaunchAgentInstallPlan,
  createManagedServerSidecarLaunchPlan,
  createManagedServerStartPlan,
  createManagedServerStatusReader,
  inspectMacLaunchAgent,
  inspectManagedServerLifecycle,
  type ManagedServerLifecycleStatus,
  type ManagedServerStatus,
  type SetupDraft
} from "./index.js";
import type {
  InitialSetupStatusReader,
  InitialSetupSubmitter
} from "./operations.js";
import {
  createInitialSetupStatusReader,
  createInitialSetupSubmitter,
  isManagedServerApiError
} from "./operations.js";
import type {
  DesktopEnvironment,
  ManagedServerRuntimeEvent,
  TauriDesktopRuntime
} from "./runtime.js";

export type ManagerServerPhase =
  | "checking"
  | "stopped"
  | "starting"
  | "running"
  | "port-conflict"
  | "unhealthy"
  | "stopping"
  | "crashed";

export type ManagerSetupPhase =
  "unknown" | "required" | "submitting" | "complete" | "unavailable" | "error";

export type ManagerStartupPhase =
  | "checking"
  | "unsupported"
  | "disabled"
  | "enabled"
  | "outdated"
  | "updating"
  | "error";

export interface SetupFormInput extends SetupDraft {
  confirmPassword: string;
}

export interface SetupValidationSuccess {
  valid: true;
  value: InitialSetupRequest;
  errors: Record<string, never>;
}

export interface SetupValidationFailure {
  valid: false;
  value: null;
  errors: Record<string, string>;
}

export type SetupValidationResult =
  SetupValidationSuccess | SetupValidationFailure;

export interface ManagerServerState {
  phase: ManagerServerPhase;
  status: ManagedServerStatus | null;
  childPid: number | null;
  managedByDesktop: boolean;
  canStart: boolean;
  canStop: boolean;
}

export interface ManagerSetupState {
  phase: ManagerSetupPhase;
  fieldErrors: Record<string, string>;
}

export interface ManagerStartupState {
  phase: ManagerStartupPhase;
  enabled: boolean;
}

export interface ManagerNetworkState {
  phase: "idle" | "saving" | "saved" | "error";
  portDraft: number | null;
  fieldErrors: Record<string, string>;
}

/** Controls whether a server probe is announced as a foreground action. */
export interface ServerRefreshOptions {
  silent?: boolean;
}

export interface DesktopManagerState {
  phase: "booting" | "ready" | "error";
  environment: DesktopEnvironment | null;
  activeConfig: Pick<AppConfig, "host" | "port">;
  persistedConfig: AppConfig | null;
  server: ManagerServerState;
  setup: ManagerSetupState;
  startup: ManagerStartupState;
  network: ManagerNetworkState;
  draft: SetupFormInput;
  announcement: string;
  processMessage: string;
  error: string | null;
}

export interface DesktopManagerDependencies {
  runtime: TauriDesktopRuntime;
  readServerStatus: (
    config: Pick<AppConfig, "host" | "port">
  ) => Promise<ManagedServerStatus>;
  readSetupStatus: InitialSetupStatusReader;
  submitInitialSetup: InitialSetupSubmitter;
  delay: (milliseconds: number) => Promise<void>;
  maxStartAttempts: number;
}

export interface DesktopManagerController {
  getState: () => DesktopManagerState;
  subscribe: (listener: (state: DesktopManagerState) => void) => () => void;
  initialize: () => Promise<void>;
  refreshServer: (options?: ServerRefreshOptions) => Promise<void>;
  startServer: () => Promise<boolean>;
  stopServer: () => Promise<boolean>;
  submitSetup: (input: SetupFormInput) => Promise<boolean>;
  updateDraft: (update: Partial<SetupFormInput>) => void;
  updatePortDraft: (port: number | null) => void;
  saveServerPort: () => Promise<boolean>;
  setStartupEnabled: (enabled: boolean) => Promise<void>;
  openWebUi: () => Promise<boolean>;
  openLogDirectory: () => Promise<boolean>;
}

const defaultActiveConfig = {
  host: "127.0.0.1" as const,
  port: 4510
};

/**
 * Validates setup fields without applying fallback values to invalid input.
 */
export const validateSetupInput = (
  input: SetupFormInput
): SetupValidationResult => {
  const parsed = initialSetupRequestSchema.safeParse({
    username: input.username.trim(),
    password: input.password
  });
  const errors: Record<string, string> = parsed.success
    ? {}
    : Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0] ?? "form"),
          issue.message
        ])
      );

  if (input.password !== input.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  if (!parsed.success || Object.keys(errors).length > 0) {
    return {
      valid: false,
      value: null,
      errors
    };
  }

  return {
    valid: true,
    value: parsed.data,
    errors: {}
  };
};

/**
 * Creates the desktop manager controller with injectable Tauri and API effects.
 */
export const createDesktopManagerController = (
  dependencies: Partial<DesktopManagerDependencies> & {
    runtime: TauriDesktopRuntime;
  }
): DesktopManagerController => {
  const resolvedDependencies: DesktopManagerDependencies = {
    runtime: dependencies.runtime,
    readServerStatus:
      dependencies.readServerStatus ?? createManagedServerStatusReader(),
    readSetupStatus:
      dependencies.readSetupStatus ?? createInitialSetupStatusReader(),
    submitInitialSetup:
      dependencies.submitInitialSetup ?? createInitialSetupSubmitter(),
    delay: dependencies.delay ?? wait,
    maxStartAttempts: dependencies.maxStartAttempts ?? 240
  };
  const listeners = new Set<(state: DesktopManagerState) => void>();
  let state = createInitialManagerState();
  let serverGeneration = 0;
  let probeGeneration = 0;

  /**
   * Replaces controller state and notifies all current subscribers.
   */
  const setState = (
    update: (current: DesktopManagerState) => DesktopManagerState
  ): void => {
    state = update(state);
    listeners.forEach((listener) => listener(state));
  };

  /**
   * Applies a health result only when it belongs to the latest probe.
   */
  const applyServerStatus = (
    status: ManagedServerStatus,
    generation: number
  ): ManagedServerLifecycleStatus | null => {
    if (generation !== probeGeneration) {
      return null;
    }

    const lifecycle = inspectManagedServerLifecycle({
      status,
      childPid: state.server.childPid
    });

    setState((current) => ({
      ...current,
      server: toManagerServerState(lifecycle, status)
    }));

    return lifecycle;
  };

  /**
   * Reloads server-owned configuration persisted through the Web UI.
   */
  const refreshPersistedConfig = async (): Promise<void> => {
    const persistedConfig =
      await resolvedDependencies.runtime.readServerConfig();

    if (!persistedConfig) {
      return;
    }

    setState((current) => ({
      ...current,
      persistedConfig,
      activeConfig: {
        host: persistedConfig.host,
        port: persistedConfig.port
      },
      network:
        current.network.phase === "idle"
          ? {
              phase: "idle",
              portDraft: persistedConfig.port,
              fieldErrors: {}
            }
          : current.network
    }));
  };

  /**
   * Reads setup status after BookCafe health has been confirmed.
   */
  const refreshSetupStatus = async (): Promise<void> => {
    try {
      const response = await resolvedDependencies.readSetupStatus(
        state.activeConfig
      );

      setState((current) => ({
        ...current,
        setup: {
          phase: response.status.setupComplete ? "complete" : "required",
          fieldErrors: {}
        }
      }));
    } catch (error) {
      if (isManagedServerApiError(error) && error.code === "DATA_UNAVAILABLE") {
        setState((current) => ({
          ...current,
          setup: { phase: "unavailable", fieldErrors: {} },
          error: null
        }));
        return;
      }

      throw error;
    }
  };

  /**
   * Probes server health and refreshes setup state when reachable.
   */
  const refreshServer = async (
    options: ServerRefreshOptions = {}
  ): Promise<void> => {
    const previousPhase = state.server.phase;
    const generation = ++probeGeneration;

    if (
      !state.server.managedByDesktop &&
      ["stopped", "crashed", "port-conflict", "unhealthy"].includes(
        previousPhase
      )
    ) {
      await refreshPersistedConfig();
    }

    if (!options.silent) {
      setState((current) => ({
        ...current,
        announcement: "Checking the BookCafe server…",
        server: {
          ...current.server,
          phase: "checking"
        }
      }));
    }

    const status = await resolvedDependencies.readServerStatus(
      state.activeConfig
    );
    const lifecycle = applyServerStatus(status, generation);

    if (!lifecycle) {
      return;
    }

    if (lifecycle.state === "running") {
      if (!options.silent) {
        await refreshSetupStatus();
      }
    } else if (state.setup.phase !== "submitting") {
      setState((current) => ({
        ...current,
        setup: { phase: "unknown", fieldErrors: {} }
      }));
    }

    if (!options.silent) {
      setState((current) => ({
        ...current,
        announcement: getServerCheckAnnouncement(lifecycle.state)
      }));
    }
  };

  /**
   * Converts a sidecar event into manager state without accepting stale events.
   */
  const handleSidecarEvent = (
    generation: number,
    event: ManagedServerRuntimeEvent
  ): void => {
    if (generation !== serverGeneration) {
      return;
    }

    if (event.type === "stdout" || event.type === "stderr") {
      setState((current) => ({
        ...current,
        processMessage: event.value.trim()
      }));
      return;
    }

    if (event.type === "error") {
      setState((current) => ({
        ...current,
        error: event.value
      }));
      return;
    }

    serverGeneration = generation + 1;

    setState((current) => ({
      ...current,
      server: {
        ...current.server,
        phase: "crashed",
        childPid: null,
        managedByDesktop: false,
        canStart: true,
        canStop: false
      },
      error:
        event.code === null
          ? "BookCafe server terminated."
          : `BookCafe server exited with code ${event.code}.`
    }));
  };

  /**
   * Waits for the spawned sidecar to become a healthy BookCafe server.
   */
  const waitForServerStart = async (
    launchGeneration: number
  ): Promise<boolean> => {
    for (
      let attempt = 0;
      attempt < resolvedDependencies.maxStartAttempts;
      attempt += 1
    ) {
      if (launchGeneration !== serverGeneration) {
        return false;
      }

      const generation = ++probeGeneration;
      const status = await resolvedDependencies.readServerStatus(
        state.activeConfig
      );

      if (launchGeneration !== serverGeneration) {
        return false;
      }

      const lifecycle = applyServerStatus(status, generation);

      if (lifecycle?.state === "running") {
        await refreshSetupStatus();
        return true;
      }

      if (
        lifecycle?.state === "port-conflict" ||
        lifecycle?.state === "unhealthy"
      ) {
        return false;
      }

      await resolvedDependencies.delay(250);
    }

    if (launchGeneration !== serverGeneration) {
      return false;
    }

    setState((current) => ({
      ...current,
      error: "BookCafe server did not become ready in time."
    }));
    return false;
  };

  /**
   * Starts the server only from a lifecycle state that permits spawning.
   */
  const startServer = async (): Promise<boolean> => {
    const environment = state.environment;

    if (!environment || !state.server.canStart) {
      return false;
    }

    try {
      await refreshPersistedConfig();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: toErrorMessage(error)
      }));
      return false;
    }

    const launchPlan = createManagedServerSidecarLaunchPlan({
      sidecarName: environment.sidecarName,
      config: state.activeConfig,
      configPath: environment.configPath
    });
    const lifecycle = state.server.status
      ? inspectManagedServerLifecycle({
          status: state.server.status,
          childPid: state.server.childPid
        })
      : createStoppedLifecycle();
    const startPlan = createManagedServerStartPlan({
      lifecycle,
      launchPlan
    });

    if (startPlan.action !== "spawn-sidecar" || !startPlan.launchPlan) {
      return false;
    }

    const generation = ++serverGeneration;
    setState((current) => ({
      ...current,
      server: {
        ...current.server,
        phase: "starting",
        canStart: false
      },
      error: null,
      announcement: "Starting BookCafe server…"
    }));

    try {
      const child = await resolvedDependencies.runtime.spawnManagedServer(
        startPlan.launchPlan,
        (event) => handleSidecarEvent(generation, event)
      );

      if (generation !== serverGeneration) {
        return false;
      }

      setState((current) => ({
        ...current,
        server: {
          ...current.server,
          phase: "starting",
          childPid: child.pid,
          managedByDesktop: true,
          canStart: false,
          canStop: true
        }
      }));

      const started = await waitForServerStart(generation);

      if (generation !== serverGeneration) {
        return false;
      }

      setState((current) => ({
        ...current,
        announcement: started
          ? "BookCafe server is running."
          : "BookCafe server could not be started."
      }));
      return started;
    } catch (error) {
      setState((current) => ({
        ...current,
        server: {
          ...current.server,
          phase: "stopped",
          childPid: null,
          managedByDesktop: false,
          canStart: true,
          canStop: false
        },
        error: toErrorMessage(error)
      }));
      return false;
    }
  };

  /**
   * Stops the current managed child without targeting external processes.
   */
  const stopServer = async (): Promise<boolean> => {
    const childPid = state.server.childPid;

    if (childPid === null || !state.server.managedByDesktop) {
      return false;
    }

    serverGeneration += 1;
    setState((current) => ({
      ...current,
      server: {
        ...current.server,
        phase: "stopping",
        canStop: false
      },
      announcement: "Stopping BookCafe server…"
    }));

    try {
      await resolvedDependencies.runtime.stopManagedServer(childPid);
      setState((current) => ({
        ...current,
        server: createStoppedServerState(),
        setup: { phase: "unknown", fieldErrors: {} },
        announcement: "BookCafe server stopped."
      }));
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        server: {
          ...current.server,
          phase: "unhealthy",
          canStop: true
        },
        error: toErrorMessage(error)
      }));
      return false;
    }
  };

  /** Submits the validated initial account to the active server. */
  const submitSetup = async (input: SetupFormInput): Promise<boolean> => {
    const validation = validateSetupInput(input);

    if (!validation.valid) {
      setState((current) => ({
        ...current,
        setup: { phase: "error", fieldErrors: validation.errors },
        error: "Review the highlighted setup fields."
      }));
      return false;
    }

    setState((current) => ({
      ...current,
      setup: { phase: "submitting", fieldErrors: {} },
      error: null,
      announcement: "Saving BookCafe setup…"
    }));

    try {
      const submission = await resolvedDependencies.submitInitialSetup(
        state.activeConfig,
        validation.value
      );

      setState((current) => ({
        ...current,
        draft: {
          ...current.draft,
          ...submission.request,
          password: "",
          confirmPassword: ""
        },
        setup: { phase: "complete", fieldErrors: {} },
        announcement: "BookCafe setup is complete."
      }));
      return true;
    } catch (error) {
      const dataUnavailable =
        isManagedServerApiError(error) && error.code === "DATA_UNAVAILABLE";

      setState((current) => ({
        ...current,
        setup: {
          phase: dataUnavailable ? "unavailable" : "error",
          fieldErrors: {}
        },
        error: dataUnavailable ? null : getSetupSubmissionErrorMessage(error)
      }));
      return false;
    }
  };

  /**
   * Refreshes platform-specific login startup state.
   */
  const refreshStartup = async (): Promise<void> => {
    const environment = state.environment;

    if (!environment || environment.platform === "linux") {
      setState((current) => ({
        ...current,
        startup: { phase: "unsupported", enabled: false }
      }));
      return;
    }

    try {
      if (environment.platform === "windows") {
        const enabled =
          await resolvedDependencies.runtime.isWindowsAutostartEnabled();
        setState((current) => ({
          ...current,
          startup: {
            phase: enabled ? "enabled" : "disabled",
            enabled
          }
        }));
        return;
      }

      const agent = createLaunchAgent(environment);
      const currentPlist =
        await resolvedDependencies.runtime.readMacLaunchAgentPlist();
      const status = inspectMacLaunchAgent({
        agent,
        homeDir: environment.homeDir,
        currentPlist
      });
      setState((current) => ({
        ...current,
        startup: {
          phase:
            status.status === "current"
              ? "enabled"
              : status.status === "outdated"
                ? "outdated"
                : "disabled",
          enabled: status.status === "current"
        }
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        startup: { phase: "error", enabled: false },
        error: toErrorMessage(error)
      }));
    }
  };

  /**
   * Enables or disables the platform-specific login startup behavior.
   */
  const setStartupEnabled = async (enabled: boolean): Promise<void> => {
    const environment = state.environment;

    if (!environment || environment.platform === "linux") {
      return;
    }

    setState((current) => ({
      ...current,
      startup: { ...current.startup, phase: "updating" },
      error: null
    }));

    try {
      if (environment.platform === "windows") {
        await (enabled
          ? resolvedDependencies.runtime.enableWindowsAutostart()
          : resolvedDependencies.runtime.disableWindowsAutostart());
      } else if (enabled) {
        const agent = createLaunchAgent(environment);
        const currentPlist =
          await resolvedDependencies.runtime.readMacLaunchAgentPlist();
        const plan = createMacLaunchAgentInstallPlan({
          agent,
          homeDir: environment.homeDir,
          currentPlist
        });

        if (plan.action !== "none") {
          await resolvedDependencies.runtime.installMacLaunchAgent(plan.plist);
        }
      } else {
        await resolvedDependencies.runtime.removeMacLaunchAgent();
      }

      setState((current) => ({
        ...current,
        startup: {
          phase: enabled ? "enabled" : "disabled",
          enabled
        },
        announcement: enabled
          ? "Login startup enabled."
          : "Login startup disabled."
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        startup: { phase: "error", enabled: current.startup.enabled },
        error: toErrorMessage(error)
      }));
    }
  };

  /**
   * Reads native environment, saved config, server, setup, and startup state.
   */
  const initialize = async (): Promise<void> => {
    setState((current) => ({ ...current, phase: "booting", error: null }));

    try {
      const [environment, persistedConfig] = await Promise.all([
        resolvedDependencies.runtime.readEnvironment(),
        resolvedDependencies.runtime.readServerConfig()
      ]);
      const activeConfig = persistedConfig
        ? { host: persistedConfig.host, port: persistedConfig.port }
        : defaultActiveConfig;
      const defaultDraft = createDefaultSetupDraft();

      setState((current) => ({
        ...current,
        phase: "ready",
        environment,
        persistedConfig,
        activeConfig,
        network: {
          phase: "idle",
          portDraft: activeConfig.port,
          fieldErrors: {}
        },
        draft: {
          ...defaultDraft,
          confirmPassword: ""
        }
      }));

      await refreshServer();
      await refreshStartup();

      if (
        environment.platform === "windows" &&
        state.server.phase === "stopped"
      ) {
        await startServer();
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: "error",
        error: toErrorMessage(error)
      }));
    }
  };

  /**
   * Updates setup draft fields and clears errors for the edited fields.
   */
  const updateDraft = (update: Partial<SetupFormInput>): void => {
    const updatedFields = new Set(Object.keys(update));

    setState((current) => ({
      ...current,
      draft: { ...current.draft, ...update },
      setup: {
        ...current.setup,
        fieldErrors: Object.fromEntries(
          Object.entries(current.setup.fieldErrors).filter(
            ([field]) => !updatedFields.has(field)
          )
        )
      }
    }));
  };

  /**
   * Updates the editable port and clears its previous field error.
   */
  const updatePortDraft = (port: number | null): void => {
    setState((current) => ({
      ...current,
      network: {
        ...current.network,
        phase: "idle",
        portDraft: port,
        fieldErrors: {}
      }
    }));
  };

  /**
   * Persists a valid port only while no server process is being tracked.
   */
  const saveServerPort = async (): Promise<boolean> => {
    const port = state.network.portDraft;

    if (port === null || !Number.isInteger(port) || port < 1 || port > 65535) {
      setState((current) => ({
        ...current,
        network: {
          ...current.network,
          phase: "error",
          fieldErrors: {
            port: "Server port must be between 1 and 65535."
          }
        },
        error: "Review the highlighted network fields."
      }));
      return false;
    }

    if (
      state.server.phase === "running" ||
      state.server.phase === "starting" ||
      state.server.phase === "stopping"
    ) {
      setState((current) => ({
        ...current,
        network: {
          ...current.network,
          phase: "error",
          fieldErrors: {
            port: "Stop the BookCafe server before changing its port."
          }
        },
        error: "Stop the BookCafe server before changing its port."
      }));
      return false;
    }

    setState((current) => ({
      ...current,
      network: {
        ...current.network,
        phase: "saving",
        fieldErrors: {}
      },
      error: null,
      announcement: "Saving BookCafe server port…"
    }));

    try {
      const persistedConfig =
        await resolvedDependencies.runtime.writeServerPort(port);

      setState((current) => ({
        ...current,
        persistedConfig,
        activeConfig: {
          host: persistedConfig.host,
          port: persistedConfig.port
        },
        network: {
          phase: "saved",
          portDraft: persistedConfig.port,
          fieldErrors: {}
        },
        setup: { phase: "unknown", fieldErrors: {} },
        announcement: "BookCafe server port saved."
      }));
      await refreshServer();
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        network: {
          ...current.network,
          phase: "error",
          fieldErrors: {}
        },
        error: toErrorMessage(error)
      }));
      return false;
    }
  };

  /**
   * Opens the Web UI only after BookCafe health is confirmed.
   */
  const openWebUi = async (): Promise<boolean> => {
    const rootUrl = state.server.status?.url.replace(/\/api\/health$/, "/");

    if (state.server.phase !== "running" || !rootUrl) {
      return false;
    }

    const url = state.setup.phase === "required" ? `${rootUrl}setup` : rootUrl;
    await resolvedDependencies.runtime.openUrl(url);
    return true;
  };

  /**
   * Opens the fixed native log directory after environment initialization.
   */
  const openLogDirectory = async (): Promise<boolean> => {
    if (!state.environment) {
      return false;
    }

    try {
      await resolvedDependencies.runtime.openLogDirectory();
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        error: toErrorMessage(error)
      }));
      return false;
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    initialize,
    refreshServer,
    startServer,
    stopServer,
    submitSetup,
    updateDraft,
    updatePortDraft,
    saveServerPort,
    setStartupEnabled,
    openWebUi,
    openLogDirectory
  };
};

/**
 * Creates the initial immutable manager state.
 */
const createInitialManagerState = (): DesktopManagerState => ({
  phase: "booting",
  environment: null,
  activeConfig: defaultActiveConfig,
  persistedConfig: null,
  server: {
    phase: "checking",
    status: null,
    childPid: null,
    managedByDesktop: false,
    canStart: false,
    canStop: false
  },
  setup: { phase: "unknown", fieldErrors: {} },
  startup: { phase: "checking", enabled: false },
  network: {
    phase: "idle",
    portDraft: defaultActiveConfig.port,
    fieldErrors: {}
  },
  draft: {
    ...createDefaultSetupDraft(),
    confirmPassword: ""
  },
  announcement: "",
  processMessage: "",
  error: null
});

/**
 * Converts lifecycle inspection into the UI-facing server state.
 */
const toManagerServerState = (
  lifecycle: ManagedServerLifecycleStatus,
  status: ManagedServerStatus
): ManagerServerState => ({
  phase: lifecycle.state,
  status,
  childPid: lifecycle.childPid,
  managedByDesktop: lifecycle.managedByDesktop,
  canStart: lifecycle.canStart,
  canStop: lifecycle.canStop
});

/**
 * Creates a stopped lifecycle for the initial spawn plan.
 */
const createStoppedLifecycle = (): ManagedServerLifecycleStatus => ({
  state: "stopped",
  reachable: false,
  managedByDesktop: false,
  childPid: null,
  canStart: true,
  canStop: false,
  status: "unreachable"
});

/**
 * Creates the manager state after a managed child has stopped.
 */
const createStoppedServerState = (): ManagerServerState => ({
  phase: "stopped",
  status: null,
  childPid: null,
  managedByDesktop: false,
  canStart: true,
  canStop: false
});

/**
 * Creates the fixed macOS LaunchAgent model from the native environment.
 */
const createLaunchAgent = (environment: DesktopEnvironment) =>
  createBookCafeServerLaunchAgent({
    serverCommand: environment.sidecarPath,
    configPath: environment.configPath,
    logDir: environment.logDir
  });

/** Returns the screen-reader announcement for a completed health probe. */
const getServerCheckAnnouncement = (
  phase: ManagedServerLifecycleStatus["state"]
): string => {
  if (phase === "running") {
    return "Server check complete. BookCafe is running.";
  }

  if (phase === "stopped") {
    return "Server check complete. BookCafe is stopped.";
  }

  if (phase === "port-conflict") {
    return "Server check complete. The configured port is in use.";
  }

  return "Server check complete. BookCafe needs attention.";
};

const setupApiErrorMessages = {
  INVALID_INPUT: "Initial setup input is invalid.",
  INVALID_SETUP_INPUT: "Initial setup input is invalid.",
  INVALID_CREDENTIALS: "Username or password is invalid.",
  INVALID_LIBRARY_PATH: "Library path is invalid.",
  SETUP_LOCAL_ONLY: "Initial setup is available only from this device.",
  SETUP_REQUIRED: "BookCafe setup is required.",
  ALREADY_INITIALIZED: "BookCafe setup is already complete.",
  SIGN_UP_DISABLED: "Account creation is disabled.",
  DATA_UNAVAILABLE: "BookCafe data is unavailable.",
  LIBRARY_BUSY: "Library is busy.",
  LIBRARY_NAME_CONFLICT: "Library name is already in use.",
  LIBRARY_PATH_CONFLICT: "Library path overlaps another library.",
  COLLECTION_NAME_CONFLICT: "Collection name is already in use.",
  NOT_FOUND: "The requested item was not found.",
  UNAUTHORIZED: "Authentication required.",
  INTERNAL_ERROR: "Internal server error."
} as const satisfies Record<ApiErrorCode, string>;

/**
 * Converts a structured setup API failure into a stable presentation key.
 */
const getSetupSubmissionErrorMessage = (error: unknown): string => {
  if (!isManagedServerApiError(error) || !error.code) {
    return toErrorMessage(error);
  }

  return setupApiErrorMessages[error.code];
};

/**
 * Converts unknown rejections into display-safe messages.
 */
const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The desktop operation failed.";

/**
 * Resolves after the requested polling interval.
 */
const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
