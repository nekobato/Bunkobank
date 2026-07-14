<script setup lang="ts">
import { getApiErrorMessage } from "../utils/apiErrors";

const {
  apiBase,
  cancelJob,
  createCollectionRoot,
  createInitialSetup,
  createScanAllJobs,
  createScanJob,
  deleteCollectionRoot,
  getNetworkSettings,
  getSetupStatus,
  getThumbnailSettings,
  listCollectionRoots,
  listJobs,
  updateNetworkSettings,
  updateThumbnailSettings
} = useBookApi();
const { session, signInWithUsername } = useBookAuth();
const username = ref("");
const password = ref("");
const dataDir = ref("");
const host = ref<"127.0.0.1" | "0.0.0.0">("127.0.0.1");
const port = ref(4510);
const thumbnailEnabled = ref(true);
const rootPath = ref("");
const message = ref("");
const rootMessage = ref("");
const networkMessage = ref("");
const thumbnailMessage = ref("");
const jobMessage = ref("");
const isSaving = ref(false);
const isSavingNetwork = ref(false);
const isSavingThumbnails = ref(false);
const isAddingRoot = ref(false);
const isScanningAll = ref(false);
const scanningRootId = ref<string | null>(null);
const deletingRootId = ref<string | null>(null);
const confirmingRootId = ref<string | null>(null);
const cancellingJobId = ref<string | null>(null);
const {
  data: setupStatus,
  status: setupRequestStatus,
  error: setupError,
  refresh
} = await useAsyncData("setup-status", getSetupStatus, {
  server: false
});
const canUseProtectedApi = computed(
  () =>
    setupStatus.value?.setupComplete === true &&
    Boolean(session.value.data?.user)
);
const { data: networkData, refresh: refreshNetwork } = await useAsyncData(
  "network-settings",
  () =>
    canUseProtectedApi.value ? getNetworkSettings() : Promise.resolve(null),
  {
    default: () => null,
    server: false,
    watch: [canUseProtectedApi]
  }
);
const { data: thumbnailData, refresh: refreshThumbnails } = await useAsyncData(
  "thumbnail-settings",
  () =>
    canUseProtectedApi.value ? getThumbnailSettings() : Promise.resolve(null),
  {
    default: () => null,
    server: false,
    watch: [canUseProtectedApi]
  }
);
const { data: rootsData, refresh: refreshRoots } = await useAsyncData(
  "collection-roots",
  () =>
    canUseProtectedApi.value
      ? listCollectionRoots()
      : Promise.resolve({ roots: [] }),
  {
    default: () => ({ roots: [] }),
    server: false,
    watch: [canUseProtectedApi]
  }
);
const { data: jobsData, refresh: refreshJobs } = await useAsyncData(
  "background-jobs",
  () => (canUseProtectedApi.value ? listJobs() : Promise.resolve({ jobs: [] })),
  {
    default: () => ({ jobs: [] }),
    server: false,
    watch: [canUseProtectedApi]
  }
);

const roots = computed(() => rootsData.value?.roots ?? []);
const jobs = computed(() => jobsData.value?.jobs ?? []);
const protectedStatus = computed(() =>
  setupStatus.value?.setupComplete && !session.value.data?.user
    ? "Login required"
    : ""
);
const setupStateLabel = computed(() => {
  if (["idle", "pending"].includes(setupRequestStatus.value)) {
    return "Loading";
  }

  if (setupRequestStatus.value === "error") {
    return "Unavailable";
  }

  return setupStatus.value?.setupComplete ? "Complete" : "Required";
});
const canSubmitInitialSetup = computed(
  () =>
    setupRequestStatus.value === "success" &&
    setupStatus.value?.setupComplete === false
);
const canScanRoots = computed(
  () => canUseProtectedApi.value && roots.value.length > 0
);

watch(
  [setupStatus, networkData, thumbnailData],
  ([setupValue, networkValue, thumbnailValue]) => {
    host.value = networkValue?.host ?? setupValue?.host ?? "127.0.0.1";
    port.value = networkValue?.port ?? setupValue?.port ?? 4510;
    thumbnailEnabled.value =
      thumbnailValue?.enabled ?? setupValue?.thumbnails?.enabled ?? true;
  },
  { immediate: true }
);

/**
 * Sends the initial setup request to the Hono API.
 */
const submitSetup = async (): Promise<void> => {
  isSaving.value = true;
  message.value = "";

  try {
    await createInitialSetup({
      username: username.value,
      password: password.value,
      dataDir: dataDir.value || undefined,
      collectionRoots: [],
      host: host.value,
      port: port.value,
      thumbnails: { enabled: thumbnailEnabled.value }
    });
    const signInResult = await signInWithUsername({
      username: username.value,
      password: password.value
    });

    message.value = "Saved";

    if (signInResult.error) {
      message.value = "Saved. Login required";
    }

    await refresh();
    await refreshNetwork();
    await refreshThumbnails();
    await refreshRoots();
    await refreshJobs();
  } catch (error) {
    message.value = getApiErrorMessage(error, "Failed");
  } finally {
    isSaving.value = false;
  }
};

/**
 * Saves persisted server network settings.
 */
const submitNetworkSettings = async (): Promise<void> => {
  isSavingNetwork.value = true;
  networkMessage.value = "";

  try {
    const response = await updateNetworkSettings({
      host: host.value,
      port: port.value
    });

    networkData.value = response;
    networkMessage.value = response.restartRequired
      ? "Saved. Restart required"
      : "Saved";
  } catch (error) {
    networkMessage.value = getApiErrorMessage(error, "Failed");
  } finally {
    isSavingNetwork.value = false;
  }
};

/**
 * Saves persisted thumbnail settings.
 */
const submitThumbnailSettings = async (): Promise<void> => {
  isSavingThumbnails.value = true;
  thumbnailMessage.value = "";

  try {
    const response = await updateThumbnailSettings({
      enabled: thumbnailEnabled.value
    });

    thumbnailData.value = response;
    thumbnailMessage.value = "Saved";
  } catch (error) {
    thumbnailMessage.value = getApiErrorMessage(error, "Failed");
  } finally {
    isSavingThumbnails.value = false;
  }
};

/**
 * Saves a collection root path.
 */
const submitCollectionRoot = async (): Promise<void> => {
  isAddingRoot.value = true;
  rootMessage.value = "";

  try {
    await createCollectionRoot({ path: rootPath.value });
    rootPath.value = "";
    rootMessage.value = "Saved";
    await refreshRoots();
  } catch (error) {
    rootMessage.value = getApiErrorMessage(error, "Failed");
  } finally {
    isAddingRoot.value = false;
  }
};

/**
 * Starts a scan job for a collection root.
 */
const scanRoot = async (collectionRootId: string): Promise<void> => {
  scanningRootId.value = collectionRootId;
  rootMessage.value = "";

  try {
    await createScanJob({ collectionRootId });
    rootMessage.value = "Scan queued";
    await refreshJobs();
  } catch (error) {
    rootMessage.value = getApiErrorMessage(error, "Failed");
  } finally {
    scanningRootId.value = null;
  }
};

/**
 * Removes one empty collection root from persisted settings.
 */
const removeRoot = async (collectionRootId: string): Promise<void> => {
  deletingRootId.value = collectionRootId;
  rootMessage.value = "";

  try {
    await deleteCollectionRoot(collectionRootId);
    rootMessage.value = "Removed";
    await refreshRoots();
  } catch (error) {
    rootMessage.value = getApiErrorMessage(error, "Failed");
  } finally {
    deletingRootId.value = null;
    confirmingRootId.value = null;
  }
};

/** Reveals an inline confirmation before removing one collection root. */
const requestRootRemoval = (collectionRootId: string): void => {
  confirmingRootId.value = collectionRootId;
  rootMessage.value = "Confirm removal of this collection root.";
};

/** Cancels a pending collection-root removal confirmation. */
const cancelRootRemoval = (): void => {
  confirmingRootId.value = null;
  rootMessage.value = "Removal cancelled";
};

/**
 * Starts scan jobs for every configured collection root.
 */
const scanAllRoots = async (): Promise<void> => {
  isScanningAll.value = true;
  rootMessage.value = "";

  try {
    const response = await createScanAllJobs();
    rootMessage.value = `Queued ${response.jobs.length} scans`;
    await refreshJobs();
  } catch (error) {
    rootMessage.value = getApiErrorMessage(error, "Failed");
  } finally {
    isScanningAll.value = false;
  }
};

/**
 * Cancels one queued or running scan job.
 */
const cancelScanJob = async (jobId: string): Promise<void> => {
  if (cancellingJobId.value) {
    return;
  }

  cancellingJobId.value = jobId;
  jobMessage.value = "";

  try {
    await cancelJob(jobId);
    jobMessage.value = "Scan cancelled";
    await refreshJobs();
  } catch (error) {
    jobMessage.value = getApiErrorMessage(error, "Failed to cancel scan");
  } finally {
    cancellingJobId.value = null;
  }
};
</script>

<template>
  <section class="setup">
    <div class="heading">
      <h1>Setup</h1>
      <p>{{ setupStateLabel }}</p>
    </div>
    <section
      v-if="setupRequestStatus === 'error'"
      class="panel"
      role="alert"
      aria-labelledby="setup-unavailable-title"
    >
      <div class="section-head">
        <h2 id="setup-unavailable-title">Setup unavailable</h2>
        <button type="button" @click="() => refresh()">Retry</button>
      </div>
      <p class="message">
        {{ getApiErrorMessage(setupError, "Could not reach BookCafe") }}
      </p>
    </section>
    <p
      v-else-if="['idle', 'pending'].includes(setupRequestStatus)"
      class="message"
      role="status"
    >
      Checking setup status…
    </p>
    <form
      v-if="canSubmitInitialSetup"
      class="form"
      :action="`${apiBase}/setup/initial-user`"
      method="post"
      @submit.prevent="submitSetup"
    >
      <label class="field" for="setup-username">
        <span>Username</span>
        <input
          id="setup-username"
          v-model="username"
          name="username"
          autocomplete="username"
          required
        />
      </label>
      <label class="field" for="setup-password">
        <span>Password</span>
        <input
          id="setup-password"
          v-model="password"
          name="password"
          type="password"
          autocomplete="new-password"
          minlength="8"
          required
        />
      </label>
      <label class="field" for="setup-data-dir">
        <span>Data directory</span>
        <input
          id="setup-data-dir"
          v-model="dataDir"
          name="dataDir"
          placeholder="Default"
        />
      </label>
      <fieldset class="choice-group">
        <legend>Bind address</legend>
        <label class="choice" for="setup-host-local">
          <input
            id="setup-host-local"
            v-model="host"
            name="host"
            type="radio"
            value="127.0.0.1"
            required
          />
          <span>Local</span>
          <span class="value">127.0.0.1</span>
        </label>
        <label class="choice" for="setup-host-lan">
          <input
            id="setup-host-lan"
            v-model="host"
            name="host"
            type="radio"
            value="0.0.0.0"
            required
          />
          <span>LAN</span>
          <span class="value">0.0.0.0</span>
        </label>
      </fieldset>
      <label class="field" for="setup-port">
        <span>Port</span>
        <input
          id="setup-port"
          v-model.number="port"
          name="port"
          type="number"
          min="1"
          max="65535"
          required
        />
      </label>
      <fieldset class="choice-group">
        <legend>Thumbnails</legend>
        <label class="choice" for="setup-thumbnail-enabled">
          <input
            id="setup-thumbnail-enabled"
            v-model="thumbnailEnabled"
            name="thumbnailEnabled"
            type="checkbox"
          />
          <span>Store cover thumbnails</span>
          <span class="value">{{ thumbnailEnabled ? "On" : "Off" }}</span>
        </label>
      </fieldset>
      <button type="submit" :disabled="isSaving">
        {{ isSaving ? "Saving" : "Save" }}
      </button>
      <p v-if="message" class="message" aria-live="polite">{{ message }}</p>
    </form>

    <section
      v-else-if="setupStatus?.setupComplete"
      class="panel"
      aria-labelledby="setup-complete-title"
    >
      <div class="section-head">
        <h2 id="setup-complete-title">Initial setup complete</h2>
      </div>
      <p class="message">
        The local account and storage location are configured. Use the settings
        below for later changes.
      </p>
    </section>

    <section
      v-if="setupStatus?.setupComplete"
      class="panel"
      aria-labelledby="network-title"
    >
      <div class="section-head">
        <h2 id="network-title">Network</h2>
      </div>
      <form
        class="form"
        :action="`${apiBase}/settings/network`"
        method="post"
        @submit.prevent="submitNetworkSettings"
      >
        <fieldset class="choice-group">
          <legend>Bind address</legend>
          <label class="choice" for="network-host-local">
            <input
              id="network-host-local"
              v-model="host"
              name="networkHost"
              type="radio"
              value="127.0.0.1"
              required
            />
            <span>Local</span>
            <span class="value">127.0.0.1</span>
          </label>
          <label class="choice" for="network-host-lan">
            <input
              id="network-host-lan"
              v-model="host"
              name="networkHost"
              type="radio"
              value="0.0.0.0"
              required
            />
            <span>LAN</span>
            <span class="value">0.0.0.0</span>
          </label>
        </fieldset>
        <label class="field" for="network-port">
          <span>Port</span>
          <input
            id="network-port"
            v-model.number="port"
            name="port"
            type="number"
            min="1"
            max="65535"
            required
          />
        </label>
        <button
          type="submit"
          :disabled="isSavingNetwork || !canUseProtectedApi"
        >
          {{ isSavingNetwork ? "Saving" : "Save network" }}
        </button>
        <p v-if="networkMessage" class="message" aria-live="polite">
          {{ networkMessage }}
        </p>
        <p v-else-if="protectedStatus" class="message">
          {{ protectedStatus }}
        </p>
      </form>
    </section>

    <section
      v-if="setupStatus?.setupComplete"
      class="panel"
      aria-labelledby="thumbnail-title"
    >
      <div class="section-head">
        <h2 id="thumbnail-title">Thumbnails</h2>
      </div>
      <form
        class="form"
        :action="`${apiBase}/settings/thumbnails`"
        method="post"
        @submit.prevent="submitThumbnailSettings"
      >
        <label class="choice toggle" for="thumbnail-enabled">
          <input
            id="thumbnail-enabled"
            v-model="thumbnailEnabled"
            name="thumbnailEnabled"
            type="checkbox"
            :disabled="!canUseProtectedApi"
          />
          <span>Store cover thumbnails</span>
          <span class="value">{{ thumbnailEnabled ? "On" : "Off" }}</span>
        </label>
        <button
          type="submit"
          :disabled="isSavingThumbnails || !canUseProtectedApi"
        >
          {{ isSavingThumbnails ? "Saving" : "Save thumbnails" }}
        </button>
        <p v-if="thumbnailMessage" class="message" aria-live="polite">
          {{ thumbnailMessage }}
        </p>
        <p v-else-if="protectedStatus" class="message">
          {{ protectedStatus }}
        </p>
      </form>
    </section>

    <section
      v-if="setupStatus?.setupComplete"
      class="panel"
      aria-labelledby="roots-title"
    >
      <div class="section-head">
        <h2 id="roots-title">Collection roots</h2>
        <button
          type="button"
          :disabled="isScanningAll || !canScanRoots"
          @click="scanAllRoots"
        >
          {{ isScanningAll ? "Queueing" : "Scan all" }}
        </button>
      </div>
      <form
        class="form"
        :action="`${apiBase}/collection-roots`"
        method="post"
        @submit.prevent="submitCollectionRoot"
      >
        <label class="field" for="collection-root-path">
          <span>Path</span>
          <input
            id="collection-root-path"
            v-model="rootPath"
            name="path"
            autocomplete="off"
            required
          />
        </label>
        <button type="submit" :disabled="isAddingRoot || !canUseProtectedApi">
          {{ isAddingRoot ? "Saving" : "Save root" }}
        </button>
      </form>
      <ul
        v-if="roots.length > 0"
        class="root-list"
        aria-label="Collection roots"
      >
        <li v-for="root in roots" :key="root.id" class="root-item">
          <span class="path">{{ root.path }}</span>
          <div class="root-actions">
            <button
              type="button"
              :disabled="scanningRootId === root.id"
              @click="scanRoot(root.id)"
            >
              {{ scanningRootId === root.id ? "Queueing" : "Scan" }}
            </button>
            <button
              v-if="confirmingRootId !== root.id"
              type="button"
              class="is-danger"
              :disabled="deletingRootId === root.id"
              @click="requestRootRemoval(root.id)"
            >
              Remove
            </button>
            <template v-else>
              <button
                type="button"
                class="is-danger"
                :disabled="deletingRootId === root.id"
                @click="removeRoot(root.id)"
              >
                {{ deletingRootId === root.id ? "Removing" : "Confirm remove" }}
              </button>
              <button type="button" @click="cancelRootRemoval">Keep</button>
            </template>
          </div>
        </li>
      </ul>
      <p v-else-if="protectedStatus" class="message">
        {{ protectedStatus }}
      </p>
      <p v-else class="message">No collection roots</p>
      <p v-if="rootMessage" class="message" aria-live="polite">
        {{ rootMessage }}
      </p>
    </section>

    <section
      v-if="setupStatus?.setupComplete"
      class="panel"
      aria-labelledby="jobs-title"
    >
      <div class="section-head">
        <h2 id="jobs-title">Jobs</h2>
        <button
          type="button"
          :disabled="!canUseProtectedApi"
          @click="() => refreshJobs()"
        >
          Refresh
        </button>
      </div>
      <ul v-if="jobs.length > 0" class="job-list" aria-label="Jobs">
        <li v-for="job in jobs" :key="job.id" class="job-item">
          <span class="badge">{{ job.status }}</span>
          <span class="path">{{ job.type }}</span>
          <span class="progress">{{ job.progress }}%</span>
          <button
            v-if="job.canCancel"
            type="button"
            :disabled="cancellingJobId !== null"
            @click="cancelScanJob(job.id)"
          >
            {{ cancellingJobId === job.id ? "Cancelling" : "Cancel" }}
          </button>
        </li>
      </ul>
      <p v-else-if="protectedStatus" class="message">
        {{ protectedStatus }}
      </p>
      <p v-else class="message">No jobs</p>
      <p v-if="jobMessage" class="message" aria-live="polite">
        {{ jobMessage }}
      </p>
    </section>
  </section>
</template>

<style scoped>
.setup {
  display: grid;
  gap: 1.25rem;
  width: min(720px, 100%);
  padding: clamp(1rem, 4vw, 2rem);
  margin: 0 auto;
}

.heading {
  display: grid;
  gap: 0.25rem;
}

.heading h1,
.heading p {
  margin: 0;
}

.heading p {
  color: var(--muted);
}

.form {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}

.panel {
  display: grid;
  gap: 1rem;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.section-head h2 {
  margin: 0;
  font-size: 1.1rem;
}

.section-head button {
  min-height: 2.25rem;
  padding: 0 0.85rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel);
  cursor: pointer;
}

.section-head button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field span {
  color: var(--muted);
  font-size: 0.9rem;
}

.field input,
.choice-group {
  min-height: 2.5rem;
  border: 1px solid var(--line);
  border-radius: 6px;
}

.field input {
  padding: 0 0.75rem;
}

.choice-group {
  display: grid;
  gap: 0.6rem;
  padding: 0.75rem;
  margin: 0;
}

.choice-group legend {
  padding: 0 0.25rem;
  color: var(--muted);
  font-size: 0.9rem;
}

.choice {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 0.5rem;
  align-items: center;
  min-height: 2rem;
}

.choice input {
  accent-color: var(--accent);
}

.toggle {
  min-height: 2.5rem;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
}

.toggle:has(input:disabled) {
  opacity: 0.65;
}

.value {
  color: var(--muted);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.form button {
  min-height: 2.5rem;
  border: 0;
  border-radius: 6px;
  color: #fff;
  background: var(--accent);
  cursor: pointer;
}

.form button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.root-list,
.job-list {
  display: grid;
  gap: 0.5rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.root-item,
.job-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}

.job-item {
  grid-template-columns: auto minmax(0, 1fr) auto auto;
}

.path {
  min-width: 0;
  overflow-wrap: anywhere;
}

.root-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.5rem;
}

.root-actions button {
  min-height: 2.25rem;
  padding: 0 0.85rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--surface);
  cursor: pointer;
}

.job-item button {
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--surface);
  cursor: pointer;
}

.job-item button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.root-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.is-danger {
  border-color: color-mix(in oklab, var(--danger) 45%, var(--line));
  color: var(--danger);
  background: color-mix(in oklab, var(--danger) 9%, transparent);
}

.badge {
  padding: 0.25rem 0.45rem;
  border-radius: 4px;
  color: #fff;
  background: var(--accent);
  font-size: 0.8rem;
}

.progress {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.message {
  margin: 0;
  color: var(--muted);
}
</style>
