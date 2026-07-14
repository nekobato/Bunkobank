/**
 * Tauri plugin adapters for desktop manager operations.
 */

import type { AppConfig } from "@bookcafe/config/shared";
import { invoke } from "@tauri-apps/api/core";
import { open as openDirectoryDialog } from "@tauri-apps/plugin-dialog";
import { openUrl as openExternalUrl } from "@tauri-apps/plugin-opener";
import { Command } from "@tauri-apps/plugin-shell";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled
} from "@tauri-apps/plugin-autostart";

import type { ManagedServerSidecarLaunchPlan } from "./index.js";

export type DesktopPlatform = "macos" | "windows" | "linux";

export interface DesktopEnvironment {
  platform: DesktopPlatform;
  homeDir: string;
  appConfigDir: string;
  appDataDir: string;
  configPath: string;
  logDir: string;
  sidecarName: string;
  sidecarPath: string;
}

export interface RuntimeChild {
  pid: number;
  kill: () => Promise<void>;
}

export interface ManagedServerSpawnResult {
  pid: number;
}

export interface RuntimeTerminatedPayload {
  code: number | null;
  signal: number | null;
}

export interface RuntimeSidecarCommand {
  onClose: (listener: (payload: RuntimeTerminatedPayload) => void) => void;
  onError: (listener: (error: string) => void) => void;
  stdout: {
    on: (event: "data", listener: (value: string) => void) => void;
  };
  stderr: {
    on: (event: "data", listener: (value: string) => void) => void;
  };
  spawn: () => Promise<RuntimeChild>;
}

export type RuntimeInvoke = <Result>(
  command: string,
  args?: Record<string, unknown>
) => Promise<Result>;

export type RuntimeDirectorySelection = string | string[] | null;

export interface TauriRuntimeBindings {
  invoke: RuntimeInvoke;
  createSidecar: (name: string, args: string[]) => RuntimeSidecarCommand;
  openDirectory: (multiple: boolean) => Promise<RuntimeDirectorySelection>;
  openUrl: (url: string) => Promise<void>;
  isAutostartEnabled: () => Promise<boolean>;
  enableAutostart: () => Promise<void>;
  disableAutostart: () => Promise<void>;
}

export type ManagedServerRuntimeEvent =
  | { type: "stdout"; value: string }
  | { type: "stderr"; value: string }
  | { type: "error"; value: string }
  | {
      type: "terminated";
      code: number | null;
      signal: number | null;
    };

export interface TauriDesktopRuntime {
  readEnvironment: () => Promise<DesktopEnvironment>;
  readServerConfig: () => Promise<AppConfig | null>;
  pickDirectory: () => Promise<string | null>;
  pickDirectories: () => Promise<string[]>;
  spawnManagedServer: (
    plan: ManagedServerSidecarLaunchPlan,
    onEvent?: (event: ManagedServerRuntimeEvent) => void
  ) => Promise<ManagedServerSpawnResult>;
  stopManagedServer: (pid: number) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  readMacLaunchAgentPlist: () => Promise<string | null>;
  installMacLaunchAgent: (plist: string) => Promise<void>;
  removeMacLaunchAgent: () => Promise<void>;
  isWindowsAutostartEnabled: () => Promise<boolean>;
  enableWindowsAutostart: () => Promise<void>;
  disableWindowsAutostart: () => Promise<void>;
}

const defaultBindings: TauriRuntimeBindings = {
  invoke,
  createSidecar: createRuntimeSidecarCommand,
  openDirectory: (multiple) =>
    openDirectoryDialog({
      directory: true,
      multiple,
      title: multiple ? "Choose collection folders" : "Choose a folder"
    }),
  openUrl: openExternalUrl,
  isAutostartEnabled,
  enableAutostart,
  disableAutostart
};

/**
 * Creates the Tauri runtime adapter and its in-memory managed child registry.
 */
export const createTauriDesktopRuntime = (
  bindings: TauriRuntimeBindings = defaultBindings
): TauriDesktopRuntime => {
  const managedChildren = new Map<number, RuntimeChild>();

  /**
   * Spawns the configured server sidecar and retains its kill-capable handle.
   */
  const spawnManagedServer: TauriDesktopRuntime["spawnManagedServer"] = async (
    plan,
    onEvent = () => undefined
  ) => {
    assertSidecarConfigArguments(plan.args);

    const command = bindings.createSidecar(plan.commandName, plan.args);
    let childPid: number | null = null;
    let terminatedBeforeRegistration = false;

    command.onClose((payload) => {
      if (childPid === null) {
        terminatedBeforeRegistration = true;
      } else {
        managedChildren.delete(childPid);
      }

      onEvent({
        type: "terminated",
        code: payload.code,
        signal: payload.signal
      });
    });
    command.onError((value) => onEvent({ type: "error", value }));
    command.stdout.on("data", (value) => onEvent({ type: "stdout", value }));
    command.stderr.on("data", (value) => onEvent({ type: "stderr", value }));

    const child = await command.spawn();
    childPid = child.pid;

    if (!terminatedBeforeRegistration) {
      managedChildren.set(child.pid, child);
    }

    return { pid: child.pid };
  };

  /**
   * Stops a child only when its Tauri handle was created by this runtime.
   */
  const stopManagedServer: TauriDesktopRuntime["stopManagedServer"] = async (
    pid
  ) => {
    const child = managedChildren.get(pid);

    if (!child) {
      throw new Error(`Managed sidecar child ${pid} is not available.`);
    }

    await child.kill();
    managedChildren.delete(pid);
  };

  return {
    readEnvironment: () => bindings.invoke("get_desktop_environment"),
    readServerConfig: () => bindings.invoke("read_server_config"),
    pickDirectory: async () =>
      getSingleDirectory(await bindings.openDirectory(false)),
    pickDirectories: async () =>
      getMultipleDirectories(await bindings.openDirectory(true)),
    spawnManagedServer,
    stopManagedServer,
    openUrl: bindings.openUrl,
    readMacLaunchAgentPlist: () =>
      bindings.invoke("read_mac_launch_agent_plist"),
    installMacLaunchAgent: (plist) =>
      bindings.invoke("install_mac_launch_agent", { plist }),
    removeMacLaunchAgent: () => bindings.invoke("remove_mac_launch_agent"),
    isWindowsAutostartEnabled: bindings.isAutostartEnabled,
    enableWindowsAutostart: bindings.enableAutostart,
    disableWindowsAutostart: bindings.disableAutostart
  };
};

/**
 * Wraps the plugin-shell Command with the narrow runtime event interface.
 */
function createRuntimeSidecarCommand(
  name: string,
  args: string[]
): RuntimeSidecarCommand {
  const command = Command.sidecar(name, args);

  return {
    onClose: (listener) => {
      command.on("close", listener);
    },
    onError: (listener) => {
      command.on("error", listener);
    },
    stdout: command.stdout,
    stderr: command.stderr,
    spawn: () => command.spawn()
  };
}

/**
 * Enforces the single capability-safe sidecar argument shape.
 */
const assertSidecarConfigArguments = (args: readonly string[]): void => {
  if (args.length !== 2 || args[0] !== "--config" || !args[1]?.trim()) {
    throw new Error("Managed sidecar requires --config with one path.");
  }
};

/**
 * Normalizes a native single-directory selection.
 */
const getSingleDirectory = (
  selection: RuntimeDirectorySelection
): string | null =>
  typeof selection === "string" ? selection : (selection?.[0] ?? null);

/**
 * Normalizes a native multi-directory selection.
 */
const getMultipleDirectories = (
  selection: RuntimeDirectorySelection
): string[] =>
  Array.isArray(selection)
    ? selection
    : typeof selection === "string"
      ? [selection]
      : [];
