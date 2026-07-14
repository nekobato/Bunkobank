<script setup lang="ts">
/* eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/multiline-html-element-content-newline */
/** Vue root view for the BookCafe desktop manager. */

import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef
} from "vue";

import type {
  DesktopManagerController,
  DesktopManagerState,
  ManagerServerPhase,
  ManagerSetupPhase,
  ManagerStartupPhase
} from "./manager.js";

const { controller } = defineProps<{ controller: DesktopManagerController }>();
const state = shallowRef<DesktopManagerState>(controller.getState());
const errorSummary = ref<HTMLElement | null>(null);
const setupForm = ref<HTMLFormElement | null>(null);
const revealPassword = ref(false);
let unsubscribe: (() => void) | undefined;
let previousErrorKey = "";

const serverLabels: Record<ManagerServerPhase, string> = {
  checking: "Checking server",
  stopped: "Server stopped",
  starting: "Starting server",
  running: "Server running",
  "port-conflict": "Port in use",
  unhealthy: "Server needs attention",
  stopping: "Stopping server",
  crashed: "Server exited"
};

const setupLabels: Record<ManagerSetupPhase, string> = {
  unknown: "Waiting for server",
  required: "Setup required",
  submitting: "Saving",
  "restart-required": "Restart required",
  complete: "Configured",
  error: "Review fields"
};

const startupLabels: Record<ManagerStartupPhase, string> = {
  checking: "Checking",
  unsupported: "Not managed here",
  disabled: "Off",
  enabled: "On",
  outdated: "Update needed",
  updating: "Updating",
  error: "Unavailable"
};

const setupComplete = computed(() =>
  ["complete", "restart-required"].includes(state.value.setup.phase)
);
const serverBusy = computed(() =>
  ["checking", "starting", "stopping"].includes(state.value.server.phase)
);
const endpoint = computed(() => {
  const { host, port } = state.value.activeConfig;
  return `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/`;
});
const savedEndpoint = computed(() => {
  const host =
    state.value.persistedConfig?.host ?? state.value.activeConfig.host;
  const port =
    state.value.persistedConfig?.port ?? state.value.activeConfig.port;
  return `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/`;
});
const errorMessages = computed(() =>
  [
    state.value.error,
    ...new Set(Object.values(state.value.setup.fieldErrors))
  ].filter((message): message is string => Boolean(message))
);
const passwordType = computed(() =>
  revealPassword.value ? "text" : "password"
);

/** Updates a string field in the controller draft. */
const updateText = (
  field: "username" | "password" | "confirmPassword",
  event: Event
): void => {
  controller.updateDraft({ [field]: (event.target as HTMLInputElement).value });
};

/** Updates the numeric server port without silently applying a fallback. */
const updatePort = (event: Event): void => {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  controller.updateDraft({ port: Number.isNaN(value) ? 0 : value });
};

/** Synchronizes native constraint validation with the accessible error state. */
const updateNativeInvalidState = (event: Event): void => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.matches(":user-invalid")) {
    input.setAttribute("aria-invalid", "true");
  } else if (!input.closest("[aria-busy='true']")) {
    input.removeAttribute("aria-invalid");
  }
};

/** Submits the current setup draft after native constraint validation. */
const submitSetup = async (): Promise<void> => {
  if (!setupForm.value?.reportValidity()) return;
  if (!(await controller.submitSetup(controller.getState().draft))) {
    await nextTick();
    errorSummary.value?.focus();
  }
};

/** Returns explanatory copy for the current server phase. */
const serverDetail = computed((): string => {
  switch (state.value.server.phase) {
    case "running":
      return state.value.server.managedByDesktop
        ? "This manager owns the active server process."
        : "BookCafe is running outside this manager. It will not be stopped here.";
    case "stopped":
      return "Start the local server to configure or open your library.";
    case "port-conflict":
      return "Another service answered on this port. Choose another port or stop that service.";
    case "unhealthy":
      return "The managed process answered unexpectedly. Check the latest process message.";
    case "crashed":
      return "The managed server exited. Check logs, then start it again.";
    default:
      return "Reading the local server and saved configuration.";
  }
});

const pulseClass = computed(() =>
  state.value.server.phase === "running"
    ? "is-running"
    : serverBusy.value
      ? "is-busy"
      : ["port-conflict", "unhealthy", "crashed"].includes(
            state.value.server.phase
          )
        ? "is-error"
        : ""
);
const setupTagClass = computed(() =>
  state.value.setup.phase === "complete"
    ? "is-good"
    : state.value.setup.phase === "error"
      ? "is-error"
      : ["required", "restart-required"].includes(state.value.setup.phase)
        ? "is-warn"
        : ""
);
const startupTagClass = computed(() =>
  state.value.startup.phase === "enabled"
    ? "is-good"
    : state.value.startup.phase === "error"
      ? "is-error"
      : state.value.startup.phase === "outdated"
        ? "is-warn"
        : ""
);
const startupTitle = computed(() =>
  state.value.environment?.platform === "macos"
    ? "Start the BookCafe server when I sign in"
    : "Start BookCafe when I sign in"
);
const startupNote = computed(() =>
  state.value.environment?.platform === "macos"
    ? "macOS uses a per-user LaunchAgent for the local server."
    : state.value.environment?.platform === "linux"
      ? "Configure systemd or another service manager outside this app."
      : "Windows starts the manager, which starts the local server."
);

onMounted(() => {
  unsubscribe = controller.subscribe((nextState) => {
    state.value = nextState;
    const errorKey = [
      nextState.error,
      ...Object.values(nextState.setup.fieldErrors)
    ]
      .filter(Boolean)
      .join("\0");
    if (errorKey && errorKey !== previousErrorKey) {
      void nextTick(() => errorSummary.value?.focus());
    }
    previousErrorKey = errorKey;
  });
  void controller.initialize();
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="manager-app" :aria-busy="state.phase === 'booting'">
    <a class="skip-link" href="#manager-content">Skip to setup</a>
    <aside class="status-rail" aria-labelledby="server-state">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">BC</span>
        <div>
          <p class="brand-name">BookCafe</p>
          <p class="brand-note">Local library manager</p>
        </div>
      </div>
      <div class="server-spine">
        <div class="pulse-track" aria-hidden="true">
          <span class="pulse-dot" :class="pulseClass" />
        </div>
        <div class="status-copy">
          <p class="eyebrow">Server status</p>
          <h2 id="server-state" class="server-state">
            {{ serverLabels[state.server.phase] }}
          </h2>
          <p class="server-detail">{{ serverDetail }}</p>
          <code class="endpoint">{{ endpoint }}</code>
          <p v-if="state.processMessage" class="server-detail">
            {{ state.processMessage }}
          </p>
        </div>
      </div>
      <div class="rail-actions" aria-label="Server controls">
        <button
          class="button is-primary"
          type="button"
          :disabled="!state.server.canStart || serverBusy"
          @click="controller.startServer()"
        >
          Start server
        </button>
        <button
          class="button is-danger"
          type="button"
          :disabled="!state.server.canStop || serverBusy"
          @click="controller.stopServer()"
        >
          Stop server
        </button>
        <button
          class="button"
          type="button"
          :disabled="state.server.phase !== 'running'"
          @click="controller.openLibrary()"
        >
          Open library
        </button>
        <button
          class="button is-quiet"
          type="button"
          :disabled="serverBusy"
          @click="controller.refreshServer()"
        >
          Check again
        </button>
      </div>
      <p class="rail-meta">
        Config<br /><span>{{
          state.environment?.configPath ?? "Loading…"
        }}</span>
      </p>
    </aside>

    <main id="manager-content" class="content" tabindex="-1">
      <header class="content-header">
        <h1 class="page-title">Bring your library online.</h1>
        <p class="page-note">
          BookCafe stays on this computer. Choose where books live, start the
          local server, then open the reader in your browser.
        </p>
      </header>
      <div class="panel-stack">
        <section
          v-if="errorMessages.length"
          ref="errorSummary"
          class="error-summary"
          tabindex="-1"
          role="alert"
        >
          <p class="error-title">BookCafe needs your attention</p>
          <ul class="error-list">
            <li v-for="message in errorMessages" :key="message">
              {{ message }}
            </li>
          </ul>
        </section>
        <section
          class="panel"
          aria-labelledby="setup-title"
          :aria-busy="state.setup.phase === 'submitting'"
        >
          <div class="panel-heading">
            <div>
              <h2 id="setup-title" class="panel-title">Library setup</h2>
              <p class="panel-note">
                Account details stay local. Folder access is granted only to
                paths you choose.
              </p>
            </div>
            <span class="phase-tag" :class="setupTagClass">{{
              setupLabels[state.setup.phase]
            }}</span>
          </div>
          <p v-if="setupComplete" class="completion-note">
            {{
              state.setup.phase === "restart-required"
                ? "Initial setup is complete. Restart the external server to use the saved endpoint."
                : "Initial setup is complete. Use Open library to manage books and metadata."
            }}
          </p>
          <div v-if="setupComplete" class="summary-grid">
            <div class="summary-item">
              <span class="summary-label">Data directory</span
              ><strong class="summary-value">{{
                state.persistedConfig?.dataDir || state.draft.dataDir || "—"
              }}</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Server endpoint</span
              ><strong class="summary-value">{{ savedEndpoint }}</strong>
            </div>
          </div>
          <form
            v-else
            ref="setupForm"
            class="setup-form"
            novalidate
            @submit.prevent="submitSetup"
          >
            <fieldset class="form-section">
              <legend class="section-title">Local account</legend>
              <div class="field-grid">
                <div class="field is-wide">
                  <label for="setup-username">Username</label
                  ><input
                    id="setup-username"
                    class="text-input"
                    name="username"
                    type="text"
                    autocomplete="username"
                    maxlength="64"
                    spellcheck="false"
                    aria-describedby="username-hint username-error"
                    aria-errormessage="username-error"
                    required
                    :value="state.draft.username"
                    :aria-invalid="
                      Boolean(state.setup.fieldErrors.username) || undefined
                    "
                    @input="updateText('username', $event)"
                    @blur="updateNativeInvalidState"
                  />
                  <p id="username-hint" class="hint">
                    Used to sign in to the BookCafe reader.
                  </p>
                  <p id="username-error" class="field-error">
                    {{ state.setup.fieldErrors.username }}
                  </p>
                </div>
                <div class="field">
                  <label for="setup-password">Password</label>
                  <div class="password-action">
                    <input
                      id="setup-password"
                      class="text-input"
                      name="password"
                      :type="passwordType"
                      autocomplete="new-password"
                      minlength="8"
                      maxlength="256"
                      aria-describedby="password-hint password-error"
                      aria-errormessage="password-error"
                      required
                      :value="state.draft.password"
                      :aria-invalid="
                        Boolean(state.setup.fieldErrors.password) || undefined
                      "
                      @input="updateText('password', $event)"
                      @blur="updateNativeInvalidState"
                    /><button
                      class="reveal-button"
                      type="button"
                      :aria-pressed="revealPassword"
                      @click="revealPassword = !revealPassword"
                    >
                      {{ revealPassword ? "Hide" : "Show" }}
                    </button>
                  </div>
                  <p id="password-hint" class="hint">
                    Use at least 8 characters.
                  </p>
                  <p id="password-error" class="field-error">
                    {{ state.setup.fieldErrors.password }}
                  </p>
                </div>
                <div class="field">
                  <label for="setup-confirm-password">Confirm password</label
                  ><input
                    id="setup-confirm-password"
                    class="text-input"
                    name="confirmPassword"
                    :type="passwordType"
                    autocomplete="new-password"
                    minlength="8"
                    maxlength="256"
                    aria-describedby="confirm-password-error"
                    aria-errormessage="confirm-password-error"
                    required
                    :value="state.draft.confirmPassword"
                    :aria-invalid="
                      Boolean(state.setup.fieldErrors.confirmPassword) ||
                      undefined
                    "
                    @input="updateText('confirmPassword', $event)"
                    @blur="updateNativeInvalidState"
                  />
                  <p id="confirm-password-error" class="field-error">
                    {{ state.setup.fieldErrors.confirmPassword }}
                  </p>
                </div>
              </div>
            </fieldset>
            <fieldset class="form-section">
              <legend class="section-title">Storage</legend>
              <div class="field-grid">
                <div class="field is-wide">
                  <label for="setup-data-dir">BookCafe data directory</label>
                  <div class="input-action">
                    <input
                      id="setup-data-dir"
                      class="text-input"
                      name="dataDir"
                      type="text"
                      aria-describedby="data-dir-hint dataDir-error"
                      aria-errormessage="dataDir-error"
                      readonly
                      required
                      :value="state.draft.dataDir"
                      :aria-invalid="
                        Boolean(state.setup.fieldErrors.dataDir) || undefined
                      "
                    /><button
                      class="button"
                      type="button"
                      @click="controller.pickDataDirectory()"
                    >
                      Choose…
                    </button>
                  </div>
                  <p id="data-dir-hint" class="hint">
                    Stores the database, thumbnails, and logs. Original books
                    are not copied.
                  </p>
                  <p id="dataDir-error" class="field-error">
                    {{ state.setup.fieldErrors.dataDir }}
                  </p>
                </div>
                <div class="field is-wide">
                  <span id="collection-label" class="field-label"
                    >Collection folders</span
                  >
                  <p id="collection-hint" class="hint">
                    Choose one or more folders containing image folders,
                    archives, PDF, or EPUB books.
                  </p>
                  <ul
                    class="folder-list"
                    aria-labelledby="collection-label"
                    aria-describedby="collection-hint collectionRoots-error"
                  >
                    <li
                      v-for="path in state.draft.collectionRoots"
                      :key="path"
                      class="folder-item"
                    >
                      <span class="folder-path">{{ path }}</span
                      ><button
                        class="button is-quiet"
                        type="button"
                        :aria-label="`Remove collection folder ${path}`"
                        @click="controller.removeCollectionFolder(path)"
                      >
                        Remove
                      </button>
                    </li>
                  </ul>
                  <p
                    v-if="state.draft.collectionRoots.length === 0"
                    class="empty-note"
                  >
                    No collection folders selected yet.
                  </p>
                  <p id="collectionRoots-error" class="field-error">
                    {{ state.setup.fieldErrors.collectionRoots }}
                  </p>
                  <div class="inline-actions">
                    <button
                      class="button"
                      type="button"
                      @click="controller.addCollectionFolders()"
                    >
                      Add folders…
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>
            <fieldset class="form-section">
              <legend class="section-title">Server access</legend>
              <div class="field-grid">
                <div class="field is-wide">
                  <span id="host-label" class="field-label"
                    >Who can connect?</span
                  >
                  <div
                    class="radio-grid"
                    role="radiogroup"
                    aria-labelledby="host-label"
                    aria-describedby="host-error"
                  >
                    <label class="radio-card"
                      ><input
                        name="host"
                        type="radio"
                        value="127.0.0.1"
                        :checked="state.draft.host === '127.0.0.1'"
                        @change="controller.updateDraft({ host: '127.0.0.1' })"
                      /><span
                        ><span class="radio-title">This computer only</span
                        ><span class="radio-note"
                          >Recommended for a private local library.</span
                        ></span
                      ></label
                    ><label class="radio-card"
                      ><input
                        name="host"
                        type="radio"
                        value="0.0.0.0"
                        :checked="state.draft.host === '0.0.0.0'"
                        @change="controller.updateDraft({ host: '0.0.0.0' })"
                      /><span
                        ><span class="radio-title">Local network</span
                        ><span class="radio-note"
                          >Listens on every network interface. Your firewall
                          still applies.</span
                        ></span
                      ></label
                    >
                  </div>
                  <p id="host-error" class="field-error">
                    {{ state.setup.fieldErrors.host }}
                  </p>
                </div>
                <div class="field">
                  <label for="setup-port">Port</label
                  ><input
                    id="setup-port"
                    class="text-input"
                    name="port"
                    type="number"
                    inputmode="numeric"
                    min="1"
                    max="65535"
                    step="1"
                    aria-describedby="port-hint port-error"
                    aria-errormessage="port-error"
                    required
                    :value="state.draft.port"
                    :aria-invalid="
                      Boolean(state.setup.fieldErrors.port) || undefined
                    "
                    @input="updatePort"
                    @blur="updateNativeInvalidState"
                  />
                  <p id="port-hint" class="hint">Default: 4510.</p>
                  <p id="port-error" class="field-error">
                    {{ state.setup.fieldErrors.port }}
                  </p>
                </div>
                <label class="check-row"
                  ><input
                    name="thumbnails"
                    type="checkbox"
                    :checked="state.draft.thumbnails.enabled"
                    @change="
                      controller.updateDraft({
                        thumbnails: {
                          enabled: ($event.target as HTMLInputElement).checked
                        }
                      })
                    "
                  /><span
                    ><span class="check-title">Store cover thumbnails</span
                    ><span class="check-note"
                      >Makes the library faster to browse and uses additional
                      disk space.</span
                    ></span
                  ></label
                >
              </div>
            </fieldset>
            <div class="form-actions">
              <button
                class="button is-primary"
                type="submit"
                :disabled="
                  state.setup.phase === 'submitting' ||
                  state.server.phase !== 'running'
                "
              >
                Save setup</button
              ><span class="hint">Start the server before saving setup.</span>
            </div>
          </form>
        </section>
        <section
          class="panel"
          aria-labelledby="startup-title"
          :aria-busy="state.startup.phase === 'updating'"
        >
          <div class="panel-heading">
            <div>
              <h2 id="startup-title" class="panel-title">Login startup</h2>
              <p class="panel-note">{{ startupNote }}</p>
            </div>
            <span class="phase-tag" :class="startupTagClass">{{
              startupLabels[state.startup.phase]
            }}</span>
          </div>
          <label class="startup-row"
            ><span
              ><span class="check-title">{{ startupTitle }}</span
              ><span class="check-note"
                >You can change this later without changing your library.</span
              ></span
            ><input
              class="switch"
              type="checkbox"
              :checked="state.startup.enabled"
              :disabled="
                state.startup.phase === 'updating' ||
                state.startup.phase === 'unsupported'
              "
              @change="
                controller.setStartupEnabled(
                  ($event.target as HTMLInputElement).checked
                )
              "
          /></label>
        </section>
      </div>
      <div
        class="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ state.announcement }}
      </div>
    </main>
  </div>
</template>
