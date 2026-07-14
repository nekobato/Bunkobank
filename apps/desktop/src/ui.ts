/**
 * Accessible DOM view for the BookCafe desktop manager controller.
 */

import type {
  DesktopManagerController,
  DesktopManagerState,
  ManagerServerPhase,
  ManagerSetupPhase,
  ManagerStartupPhase
} from "./manager.js";

interface ManagerElements {
  app: HTMLElement;
  content: HTMLElement;
  errorSummary: HTMLElement;
  errorList: HTMLUListElement;
  liveRegion: HTMLElement;
  pulseDot: HTMLElement;
  serverState: HTMLElement;
  serverDetail: HTMLElement;
  endpoint: HTMLElement;
  configPath: HTMLElement;
  processMessage: HTMLElement;
  startButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  openButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
  setupPanel: HTMLElement;
  setupTag: HTMLElement;
  setupForm: HTMLFormElement;
  initialSections: HTMLElement[];
  completion: HTMLElement;
  savedDataDir: HTMLElement;
  savedNetwork: HTMLElement;
  username: HTMLInputElement;
  password: HTMLInputElement;
  confirmPassword: HTMLInputElement;
  revealPassword: HTMLButtonElement;
  dataDir: HTMLInputElement;
  chooseDataDir: HTMLButtonElement;
  collectionList: HTMLUListElement;
  collectionEmpty: HTMLElement;
  chooseCollections: HTMLButtonElement;
  hostLocal: HTMLInputElement;
  hostLan: HTMLInputElement;
  port: HTMLInputElement;
  thumbnails: HTMLInputElement;
  submitSetup: HTMLButtonElement;
  startupPanel: HTMLElement;
  startupTag: HTMLElement;
  startupTitle: HTMLElement;
  startupNote: HTMLElement;
  startupToggle: HTMLInputElement;
  fieldErrors: Record<string, HTMLElement>;
}

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

/**
 * Mounts the manager view and returns a cleanup callback.
 */
export const mountDesktopManager = (
  root: HTMLElement,
  controller: DesktopManagerController
): (() => void) => {
  root.innerHTML = getManagerTemplate();
  const elements = getManagerElements(root);
  let previousErrorKey = "";

  bindManagerEvents(elements, controller);

  const unsubscribe = controller.subscribe((state) => {
    renderManagerState(elements, state);
    const errorKey = [state.error, ...Object.values(state.setup.fieldErrors)]
      .filter(Boolean)
      .join("\0");

    if (errorKey && errorKey !== previousErrorKey) {
      elements.errorSummary.focus({ preventScroll: false });
    }

    previousErrorKey = errorKey;
  });

  return () => {
    unsubscribe();
    root.replaceChildren();
  };
};

/**
 * Returns the static, semantic manager document structure.
 */
const getManagerTemplate = (): string => `
  <div class="manager-app" data-manager-app aria-busy="true">
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
          <span class="pulse-dot" data-pulse-dot></span>
        </div>
        <div class="status-copy">
          <p class="eyebrow">Server status</p>
          <h2 class="server-state" id="server-state" data-server-state>Checking server</h2>
          <p class="server-detail" data-server-detail>Reading the local server and saved configuration.</p>
          <code class="endpoint" data-endpoint>http://127.0.0.1:4510/</code>
          <p class="server-detail" data-process-message hidden></p>
        </div>
      </div>

      <div class="rail-actions" aria-label="Server controls">
        <button class="button is-primary" type="button" data-start-server>Start server</button>
        <button class="button is-danger" type="button" data-stop-server>Stop server</button>
        <button class="button" type="button" data-open-library>Open library</button>
        <button class="button is-quiet" type="button" data-refresh-server>Check again</button>
      </div>

      <p class="rail-meta">
        Config<br />
        <span data-config-path>Loading…</span>
      </p>
    </aside>

    <main class="content" id="manager-content" tabindex="-1" data-content>
      <header class="content-header">
        <h1 class="page-title">Bring your library online.</h1>
        <p class="page-note">
          BookCafe stays on this computer. Choose where books live, start the local server, then open the reader in your browser.
        </p>
      </header>

      <div class="panel-stack">
        <section class="error-summary" tabindex="-1" role="alert" data-error-summary hidden>
          <p class="error-title">BookCafe needs your attention</p>
          <ul class="error-list" data-error-list></ul>
        </section>

        <section class="panel" aria-labelledby="setup-title" data-setup-panel>
          <div class="panel-heading">
            <div>
              <h2 class="panel-title" id="setup-title">Library setup</h2>
              <p class="panel-note">Account details stay local. Folder access is granted only to paths you choose.</p>
            </div>
            <span class="phase-tag" data-setup-tag>Waiting for server</span>
          </div>

          <p class="completion-note" data-completion hidden>
            Initial setup is complete. Use Open library to manage books and metadata.
          </p>

          <div class="summary-grid" data-saved-summary hidden>
            <div class="summary-item">
              <span class="summary-label">Data directory</span>
              <strong class="summary-value" data-saved-data-dir>—</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Server endpoint</span>
              <strong class="summary-value" data-saved-network>—</strong>
            </div>
          </div>

          <form class="setup-form" action="/api/setup/initial-user" method="post" data-setup-form novalidate>
            <fieldset class="form-section initial-only" data-initial-section>
              <legend class="section-title">Local account</legend>
              <div class="field-grid">
                <div class="field is-wide">
                  <label for="setup-username">Username</label>
                  <input class="text-input" id="setup-username" name="username" type="text" autocomplete="username" maxlength="64" spellcheck="false" aria-describedby="username-hint username-error" aria-errormessage="username-error" required />
                  <p class="hint" id="username-hint">Used to sign in to the BookCafe reader.</p>
                  <p class="field-error" id="username-error" data-error-for="username"></p>
                </div>

                <div class="field">
                  <label for="setup-password">Password</label>
                  <div class="password-action">
                    <input class="text-input" id="setup-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" aria-describedby="password-hint password-error" aria-errormessage="password-error" required />
                    <button class="reveal-button" type="button" aria-pressed="false" data-reveal-password>Show</button>
                  </div>
                  <p class="hint" id="password-hint">Use at least 8 characters.</p>
                  <p class="field-error" id="password-error" data-error-for="password"></p>
                </div>

                <div class="field">
                  <label for="setup-confirm-password">Confirm password</label>
                  <input class="text-input" id="setup-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="256" aria-describedby="confirm-password-error" aria-errormessage="confirm-password-error" required />
                  <p class="field-error" id="confirm-password-error" data-error-for="confirmPassword"></p>
                </div>
              </div>
            </fieldset>

            <fieldset class="form-section initial-only" data-initial-section>
              <legend class="section-title">Storage</legend>
              <div class="field-grid">
                <div class="field is-wide">
                  <label for="setup-data-dir">BookCafe data directory</label>
                  <div class="input-action">
                    <input class="text-input" id="setup-data-dir" name="dataDir" type="text" aria-describedby="data-dir-hint dataDir-error" aria-errormessage="dataDir-error" readonly required />
                    <button class="button" type="button" data-choose-data-dir>Choose…</button>
                  </div>
                  <p class="hint" id="data-dir-hint">Stores the database, thumbnails, and logs. Original books are not copied.</p>
                  <p class="field-error" id="dataDir-error" data-error-for="dataDir"></p>
                </div>

                <div class="field is-wide">
                  <span class="field-label" id="collection-label">Collection folders</span>
                  <p class="hint" id="collection-hint">Choose one or more folders containing image folders, archives, PDF, or EPUB books.</p>
                  <ul class="folder-list" aria-labelledby="collection-label" aria-describedby="collection-hint collectionRoots-error" data-collection-list></ul>
                  <p class="empty-note" data-collection-empty>No collection folders selected yet.</p>
                  <p class="field-error" id="collectionRoots-error" data-error-for="collectionRoots"></p>
                  <div class="inline-actions">
                    <button class="button" type="button" data-choose-collections>Add folders…</button>
                  </div>
                </div>
              </div>
            </fieldset>

            <fieldset class="form-section initial-only" data-initial-section>
              <legend class="section-title">Server access</legend>
              <div class="field-grid">
                <div class="field is-wide">
                  <span class="field-label" id="host-label">Who can connect?</span>
                  <div class="radio-grid" role="radiogroup" aria-labelledby="host-label">
                    <label class="radio-card">
                      <input name="host" type="radio" value="127.0.0.1" data-host-local />
                      <span>
                        <span class="radio-title">This computer only</span>
                        <span class="radio-note">Recommended for a private local library.</span>
                      </span>
                    </label>
                    <label class="radio-card">
                      <input name="host" type="radio" value="0.0.0.0" data-host-lan />
                      <span>
                        <span class="radio-title">Local network</span>
                        <span class="radio-note">Listens on every network interface. Your firewall still applies.</span>
                      </span>
                    </label>
                  </div>
                  <p class="field-error" data-error-for="host"></p>
                </div>

                <div class="field">
                  <label for="setup-port">Port</label>
                  <input class="text-input" id="setup-port" name="port" type="number" inputmode="numeric" min="1" max="65535" step="1" aria-describedby="port-hint port-error" aria-errormessage="port-error" required />
                  <p class="hint" id="port-hint">Default: 4510.</p>
                  <p class="field-error" id="port-error" data-error-for="port"></p>
                </div>

                <label class="check-row">
                  <input name="thumbnails" type="checkbox" data-thumbnails />
                  <span>
                    <span class="check-title">Store cover thumbnails</span>
                    <span class="check-note">Makes the library faster to browse and uses additional disk space.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <div class="form-actions initial-only" data-initial-section>
              <button class="button is-primary" type="submit" data-submit-setup>Save setup</button>
              <span class="hint">Start the server before saving setup.</span>
            </div>
          </form>
        </section>

        <section class="panel" aria-labelledby="startup-title" data-startup-panel>
          <div class="panel-heading">
            <div>
              <h2 class="panel-title" id="startup-title">Login startup</h2>
              <p class="panel-note" data-startup-note>Keep the BookCafe server available after you sign in.</p>
            </div>
            <span class="phase-tag" data-startup-tag>Checking</span>
          </div>
          <label class="startup-row">
            <span>
              <span class="check-title" data-startup-title>Start BookCafe when I sign in</span>
              <span class="check-note">You can change this later without changing your library.</span>
            </span>
            <input class="switch" type="checkbox" data-startup-toggle />
          </label>
        </section>
      </div>

      <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-live-region></div>
    </main>
  </div>
`;

/**
 * Resolves all required view elements once after mounting.
 */
const getManagerElements = (root: HTMLElement): ManagerElements => {
  const fieldErrors = Object.fromEntries(
    Array.from(root.querySelectorAll<HTMLElement>("[data-error-for]")).map(
      (element) => [element.dataset.errorFor ?? "", element]
    )
  );

  return {
    app: getRequiredElement(root, "[data-manager-app]"),
    content: getRequiredElement(root, "[data-content]"),
    errorSummary: getRequiredElement(root, "[data-error-summary]"),
    errorList: getRequiredElement(root, "[data-error-list]"),
    liveRegion: getRequiredElement(root, "[data-live-region]"),
    pulseDot: getRequiredElement(root, "[data-pulse-dot]"),
    serverState: getRequiredElement(root, "[data-server-state]"),
    serverDetail: getRequiredElement(root, "[data-server-detail]"),
    endpoint: getRequiredElement(root, "[data-endpoint]"),
    configPath: getRequiredElement(root, "[data-config-path]"),
    processMessage: getRequiredElement(root, "[data-process-message]"),
    startButton: getRequiredElement(root, "[data-start-server]"),
    stopButton: getRequiredElement(root, "[data-stop-server]"),
    openButton: getRequiredElement(root, "[data-open-library]"),
    refreshButton: getRequiredElement(root, "[data-refresh-server]"),
    setupPanel: getRequiredElement(root, "[data-setup-panel]"),
    setupTag: getRequiredElement(root, "[data-setup-tag]"),
    setupForm: getRequiredElement(root, "[data-setup-form]"),
    initialSections: Array.from(
      root.querySelectorAll<HTMLElement>("[data-initial-section]")
    ),
    completion: getRequiredElement(root, "[data-completion]"),
    savedDataDir: getRequiredElement(root, "[data-saved-data-dir]"),
    savedNetwork: getRequiredElement(root, "[data-saved-network]"),
    username: getRequiredElement(root, "#setup-username"),
    password: getRequiredElement(root, "#setup-password"),
    confirmPassword: getRequiredElement(root, "#setup-confirm-password"),
    revealPassword: getRequiredElement(root, "[data-reveal-password]"),
    dataDir: getRequiredElement(root, "#setup-data-dir"),
    chooseDataDir: getRequiredElement(root, "[data-choose-data-dir]"),
    collectionList: getRequiredElement(root, "[data-collection-list]"),
    collectionEmpty: getRequiredElement(root, "[data-collection-empty]"),
    chooseCollections: getRequiredElement(root, "[data-choose-collections]"),
    hostLocal: getRequiredElement(root, "[data-host-local]"),
    hostLan: getRequiredElement(root, "[data-host-lan]"),
    port: getRequiredElement(root, "#setup-port"),
    thumbnails: getRequiredElement(root, "[data-thumbnails]"),
    submitSetup: getRequiredElement(root, "[data-submit-setup]"),
    startupPanel: getRequiredElement(root, "[data-startup-panel]"),
    startupTag: getRequiredElement(root, "[data-startup-tag]"),
    startupTitle: getRequiredElement(root, "[data-startup-title]"),
    startupNote: getRequiredElement(root, "[data-startup-note]"),
    startupToggle: getRequiredElement(root, "[data-startup-toggle]"),
    fieldErrors
  };
};

/**
 * Binds native controls to controller actions and draft updates.
 */
const bindManagerEvents = (
  elements: ManagerElements,
  controller: DesktopManagerController
): void => {
  elements.startButton.addEventListener("click", () => {
    void controller.startServer();
  });
  elements.stopButton.addEventListener("click", () => {
    void controller.stopServer();
  });
  elements.openButton.addEventListener("click", () => {
    void controller.openLibrary();
  });
  elements.refreshButton.addEventListener("click", () => {
    void controller.refreshServer();
  });
  elements.chooseDataDir.addEventListener("click", () => {
    void controller.pickDataDirectory();
  });
  elements.chooseCollections.addEventListener("click", () => {
    void controller.addCollectionFolders();
  });
  elements.collectionList.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button[data-remove-folder]"
    );
    const path = button?.dataset.removeFolder;

    if (path) {
      controller.removeCollectionFolder(path);
    }
  });
  elements.username.addEventListener("input", () =>
    controller.updateDraft({ username: elements.username.value })
  );
  elements.password.addEventListener("input", () =>
    controller.updateDraft({ password: elements.password.value })
  );
  elements.confirmPassword.addEventListener("input", () =>
    controller.updateDraft({ confirmPassword: elements.confirmPassword.value })
  );
  elements.port.addEventListener("input", () =>
    controller.updateDraft({
      port: Number.isNaN(elements.port.valueAsNumber)
        ? 0
        : elements.port.valueAsNumber
    })
  );
  elements.hostLocal.addEventListener("change", () => {
    if (elements.hostLocal.checked) {
      controller.updateDraft({ host: "127.0.0.1" });
    }
  });
  elements.hostLan.addEventListener("change", () => {
    if (elements.hostLan.checked) {
      controller.updateDraft({ host: "0.0.0.0" });
    }
  });
  elements.thumbnails.addEventListener("change", () =>
    controller.updateDraft({
      thumbnails: { enabled: elements.thumbnails.checked }
    })
  );
  elements.revealPassword.addEventListener("click", () => {
    const reveal = elements.password.type === "password";
    elements.password.type = reveal ? "text" : "password";
    elements.confirmPassword.type = reveal ? "text" : "password";
    elements.revealPassword.textContent = reveal ? "Hide" : "Show";
    elements.revealPassword.setAttribute("aria-pressed", String(reveal));
  });
  elements.startupToggle.addEventListener("change", () => {
    void controller.setStartupEnabled(elements.startupToggle.checked);
  });
  elements.setupForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!elements.setupForm.reportValidity()) {
      return;
    }

    void controller.submitSetup(controller.getState().draft).then((saved) => {
      if (!saved) {
        elements.errorSummary.focus();
      }
    });
  });
  elements.setupForm.addEventListener(
    "blur",
    (event) => updateNativeInvalidState(event.target),
    true
  );
  elements.setupForm.addEventListener("input", (event) => {
    const target = event.target;

    if (target instanceof HTMLInputElement && target.ariaInvalid === "true") {
      updateNativeInvalidState(target);
    }
  });
};

/**
 * Renders controller state into stable DOM nodes without replacing controls.
 */
const renderManagerState = (
  elements: ManagerElements,
  state: DesktopManagerState
): void => {
  const setupComplete = ["complete", "restart-required"].includes(
    state.setup.phase
  );
  const serverBusy = ["checking", "starting", "stopping"].includes(
    state.server.phase
  );
  const setupBusy = state.setup.phase === "submitting";
  const endpoint = `http://${state.activeConfig.host === "0.0.0.0" ? "127.0.0.1" : state.activeConfig.host}:${state.activeConfig.port}/`;

  elements.app.setAttribute("aria-busy", String(state.phase === "booting"));
  elements.serverState.textContent = serverLabels[state.server.phase];
  elements.serverDetail.textContent = getServerDetail(state);
  elements.endpoint.textContent = endpoint;
  elements.configPath.textContent = state.environment?.configPath ?? "Loading…";
  elements.processMessage.textContent = state.processMessage;
  elements.processMessage.hidden = !state.processMessage;
  elements.pulseDot.className = `pulse-dot ${getPulseClass(state.server.phase)}`;
  elements.startButton.disabled = !state.server.canStart || serverBusy;
  elements.stopButton.disabled = !state.server.canStop || serverBusy;
  elements.openButton.disabled = state.server.phase !== "running";
  elements.refreshButton.disabled = serverBusy;

  elements.setupPanel.setAttribute("aria-busy", String(setupBusy));
  elements.setupTag.textContent = setupLabels[state.setup.phase];
  elements.setupTag.className = `phase-tag ${getSetupTagClass(state.setup.phase)}`;
  elements.initialSections.forEach((element) => {
    element.hidden = setupComplete;
  });
  elements.completion.hidden = !setupComplete;
  elements.completion.textContent =
    state.setup.phase === "restart-required"
      ? "Initial setup is complete. Restart the external server to use the saved endpoint."
      : "Initial setup is complete. Use Open library to manage books and metadata.";
  const savedSummary = elements.savedDataDir.closest<HTMLElement>(
    "[data-saved-summary]"
  );
  if (savedSummary) {
    savedSummary.hidden = !setupComplete;
  }
  elements.savedDataDir.textContent =
    state.persistedConfig?.dataDir || state.draft.dataDir || "—";
  const savedHost = state.persistedConfig?.host ?? state.activeConfig.host;
  const savedNetworkHost = savedHost === "0.0.0.0" ? "127.0.0.1" : savedHost;
  const savedPort = state.persistedConfig?.port ?? state.activeConfig.port;
  elements.savedNetwork.textContent = `http://${savedNetworkHost}:${savedPort}/`;
  elements.submitSetup.disabled = setupBusy || state.server.phase !== "running";

  setInputValue(elements.username, state.draft.username);
  setInputValue(elements.password, state.draft.password);
  setInputValue(elements.confirmPassword, state.draft.confirmPassword);
  setInputValue(elements.dataDir, state.draft.dataDir);
  setInputValue(elements.port, String(state.draft.port));
  elements.hostLocal.checked = state.draft.host === "127.0.0.1";
  elements.hostLan.checked = state.draft.host === "0.0.0.0";
  elements.thumbnails.checked = state.draft.thumbnails.enabled;
  renderCollectionFolders(elements, state.draft.collectionRoots);
  renderFieldErrors(elements, state.setup.fieldErrors);
  renderErrorSummary(elements, state);

  const startupBusy = state.startup.phase === "updating";
  elements.startupPanel.setAttribute("aria-busy", String(startupBusy));
  elements.startupTag.textContent = startupLabels[state.startup.phase];
  elements.startupTag.className = `phase-tag ${getStartupTagClass(state.startup.phase)}`;
  elements.startupToggle.checked = state.startup.enabled;
  elements.startupToggle.disabled =
    startupBusy || state.startup.phase === "unsupported";
  const isMac = state.environment?.platform === "macos";
  elements.startupTitle.textContent = isMac
    ? "Start the BookCafe server when I sign in"
    : "Start BookCafe when I sign in";
  elements.startupNote.textContent = isMac
    ? "macOS uses a per-user LaunchAgent for the local server."
    : state.environment?.platform === "linux"
      ? "Configure systemd or another service manager outside this app."
      : "Windows starts the manager, which starts the local server.";

  if (state.announcement) {
    elements.liveRegion.textContent = state.announcement;
  }
};

/**
 * Renders folder paths with textContent and path-specific remove controls.
 */
const renderCollectionFolders = (
  elements: ManagerElements,
  paths: readonly string[]
): void => {
  elements.collectionList.replaceChildren(
    ...paths.map((path) => {
      const item = document.createElement("li");
      const pathText = document.createElement("span");
      const removeButton = document.createElement("button");
      item.className = "folder-item";
      pathText.className = "folder-path";
      pathText.textContent = path;
      removeButton.className = "button is-quiet";
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.dataset.removeFolder = path;
      removeButton.setAttribute(
        "aria-label",
        `Remove collection folder ${path}`
      );
      item.append(pathText, removeButton);
      return item;
    })
  );
  elements.collectionEmpty.hidden = paths.length > 0;
};

/**
 * Connects controller field errors to visible and programmatic input state.
 */
const renderFieldErrors = (
  elements: ManagerElements,
  errors: Readonly<Record<string, string>>
): void => {
  Object.entries(elements.fieldErrors).forEach(([field, element]) => {
    element.textContent = errors[field] ?? "";
  });

  const controls: Record<string, HTMLInputElement> = {
    username: elements.username,
    password: elements.password,
    confirmPassword: elements.confirmPassword,
    dataDir: elements.dataDir,
    port: elements.port
  };

  Object.entries(controls).forEach(([field, input]) => {
    if (errors[field]) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
  });
};

/**
 * Renders the centralized alert summary for operation and field errors.
 */
const renderErrorSummary = (
  elements: ManagerElements,
  state: DesktopManagerState
): void => {
  const messages = [
    state.error,
    ...Array.from(new Set(Object.values(state.setup.fieldErrors)))
  ].filter((message): message is string => Boolean(message));

  elements.errorSummary.hidden = messages.length === 0;
  elements.errorList.replaceChildren(
    ...messages.map((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      return item;
    })
  );
};

/**
 * Synchronizes native user-invalid state with aria-invalid after interaction.
 */
const updateNativeInvalidState = (target: EventTarget | null): void => {
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  if (target.matches(":user-invalid")) {
    target.setAttribute("aria-invalid", "true");
  } else if (!target.closest("[aria-busy='true']")) {
    target.removeAttribute("aria-invalid");
  }
};

/**
 * Updates an input only when it is not actively being edited.
 */
const setInputValue = (input: HTMLInputElement, value: string): void => {
  if (document.activeElement !== input && input.value !== value) {
    input.value = value;
  }
};

/**
 * Returns explanatory server copy for the current lifecycle phase.
 */
const getServerDetail = (state: DesktopManagerState): string => {
  switch (state.server.phase) {
    case "running":
      return state.server.managedByDesktop
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
};

/**
 * Maps server phase to the decorative pulse modifier class.
 */
const getPulseClass = (phase: ManagerServerPhase): string =>
  phase === "running"
    ? "is-running"
    : ["checking", "starting", "stopping"].includes(phase)
      ? "is-busy"
      : ["port-conflict", "unhealthy", "crashed"].includes(phase)
        ? "is-error"
        : "";

/**
 * Maps setup phase to a visible tag tone.
 */
const getSetupTagClass = (phase: ManagerSetupPhase): string =>
  phase === "complete"
    ? "is-good"
    : phase === "error"
      ? "is-error"
      : ["required", "restart-required"].includes(phase)
        ? "is-warn"
        : "";

/**
 * Maps startup phase to a visible tag tone.
 */
const getStartupTagClass = (phase: ManagerStartupPhase): string =>
  phase === "enabled"
    ? "is-good"
    : phase === "error"
      ? "is-error"
      : phase === "outdated"
        ? "is-warn"
        : "";

/**
 * Returns a required element or throws a precise mount-time error.
 */
const getRequiredElement = <ElementType extends Element>(
  root: ParentNode,
  selector: string
): ElementType => {
  const element = root.querySelector<ElementType>(selector);

  if (!element) {
    throw new Error(`BookCafe manager element was not found: ${selector}`);
  }

  return element;
};
