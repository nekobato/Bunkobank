<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";

import {
  getJobStatusLabel,
  getJobTone,
  getScanJobPath,
  getScanJobSummary,
  hasActiveJobs,
  listRecentJobs
} from "../utils/libraryJobs";
import { getApiErrorMessage } from "../utils/apiErrors";

const emit = defineEmits<{
  updated: [];
}>();

const {
  apiBase,
  cancelJob,
  createCollectionRoot,
  createScanAllJobs,
  createScanJob,
  deleteCollectionRoot,
  listCollectionRoots,
  listJobs
} = useBookApi();
const rootPath = ref("");
const rootMessage = ref("");
const jobMessage = ref("");
const isAddingRoot = ref(false);
const isScanningAll = ref(false);
const isRefreshingJobs = ref(false);
const cancellingJobId = ref<string | null>(null);
const scanningRootId = ref<string | null>(null);
const deletingRootId = ref<string | null>(null);
const {
  data: rootsData,
  error: rootsError,
  pending: rootsPending,
  refresh: refreshRoots
} = await useAsyncData("library-manager-roots", listCollectionRoots, {
  default: () => ({ roots: [] }),
  server: false
});
const {
  data: jobsData,
  error: jobsError,
  pending: jobsPending,
  refresh: refreshJobs
} = await useAsyncData("library-manager-jobs", listJobs, {
  default: () => ({ jobs: [] }),
  server: false
});

const roots = computed(() => rootsData.value?.roots ?? []);
const recentJobs = computed(() => listRecentJobs(jobsData.value?.jobs ?? []));
const activeJobs = computed(() => hasActiveJobs(jobsData.value?.jobs ?? []));
const canScanRoots = computed(() => roots.value.length > 0);
const rootsStatus = computed(() =>
  rootsError.value
    ? getApiErrorMessage(rootsError.value, "Failed to load roots")
    : ""
);
const jobsStatus = computed(() =>
  jobsError.value
    ? getApiErrorMessage(jobsError.value, "Failed to load jobs")
    : ""
);

const { pause, resume, isActive } = useIntervalFn(refreshJobList, 2500, {
  immediate: false
});

watch(
  activeJobs,
  (active, wasActive) => {
    if (active && !isActive.value) {
      resume();
    }

    if (!active && isActive.value) {
      pause();
    }

    if (wasActive && !active) {
      emit("updated");
    }
  },
  { immediate: true }
);

/**
 * Adds or updates a collection root from the form path.
 */
const submitCollectionRoot = async (): Promise<void> => {
  const path = rootPath.value.trim();
  rootMessage.value = "";

  if (!path) {
    rootMessage.value = "Path is required";
    return;
  }

  isAddingRoot.value = true;

  try {
    await createCollectionRoot({ path });
    rootPath.value = "";
    rootMessage.value = "Saved";
    await refreshRoots();
  } catch (error) {
    rootMessage.value = getApiErrorMessage(error, "Failed to save root");
  } finally {
    isAddingRoot.value = false;
  }
};

/**
 * Queues a scan job for one collection root.
 */
const scanRoot = async (collectionRootId: string): Promise<void> => {
  scanningRootId.value = collectionRootId;
  jobMessage.value = "";

  try {
    await createScanJob({ collectionRootId });
    jobMessage.value = "Scan queued";
    await refreshJobList();
  } catch (error) {
    jobMessage.value = getApiErrorMessage(error, "Failed to queue scan");
  } finally {
    scanningRootId.value = null;
  }
};

/**
 * Removes one empty collection root from the library settings.
 */
const removeRoot = async (collectionRootId: string): Promise<void> => {
  deletingRootId.value = collectionRootId;
  rootMessage.value = "";

  try {
    await deleteCollectionRoot(collectionRootId);
    rootMessage.value = "Removed";
    await refreshRoots();
    emit("updated");
  } catch (error) {
    rootMessage.value = getApiErrorMessage(error, "Failed to remove root");
  } finally {
    deletingRootId.value = null;
  }
};

/**
 * Queues scan jobs for every configured collection root.
 */
const scanAllRoots = async (): Promise<void> => {
  isScanningAll.value = true;
  jobMessage.value = "";

  try {
    const response = await createScanAllJobs();
    jobMessage.value = `Queued ${response.jobs.length} scans`;
    await refreshJobList();
  } catch (error) {
    jobMessage.value = getApiErrorMessage(error, "Failed to queue scans");
  } finally {
    isScanningAll.value = false;
  }
};

/**
 * Cancels one queued or running scan job and refreshes the library state.
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
    await refreshJobList();
    emit("updated");
  } catch (error) {
    jobMessage.value = getApiErrorMessage(error, "Failed to cancel scan");
  } finally {
    cancellingJobId.value = null;
  }
};

/**
 * Refreshes roots, jobs, and the parent book list together.
 */
const refreshManager = async (): Promise<void> => {
  await Promise.all([refreshRoots(), refreshJobList()]);
  emit("updated");
};

/**
 * Refreshes background jobs without allowing interval overlap.
 */
async function refreshJobList(): Promise<void> {
  if (isRefreshingJobs.value) {
    return;
  }

  isRefreshingJobs.value = true;

  try {
    await refreshJobs();
  } finally {
    isRefreshingJobs.value = false;
  }
}
</script>

<template>
  <section
    id="collections"
    class="manager"
    aria-labelledby="library-manager-title"
  >
    <div class="head">
      <h2 id="library-manager-title">Collections</h2>
      <div class="actions">
        <button type="button" :disabled="rootsPending" @click="refreshManager">
          Refresh
        </button>
        <button
          type="button"
          :disabled="isScanningAll || !canScanRoots"
          @click="scanAllRoots"
        >
          {{ isScanningAll ? "Queueing" : "Scan all" }}
        </button>
      </div>
    </div>

    <form
      class="form"
      :action="`${apiBase}/collection-roots`"
      method="post"
      @submit.prevent="submitCollectionRoot"
    >
      <label class="field" for="library-root-path">
        <span>Root path</span>
        <input
          id="library-root-path"
          v-model="rootPath"
          name="path"
          autocomplete="off"
          required
        />
      </label>
      <button type="submit" :disabled="isAddingRoot">
        {{ isAddingRoot ? "Saving" : "Save root" }}
      </button>
    </form>

    <p v-if="rootMessage" class="message" aria-live="polite">
      {{ rootMessage }}
    </p>

    <div class="grid">
      <section class="group" aria-labelledby="library-roots-title">
        <h3 id="library-roots-title">Roots</h3>
        <p v-if="rootsStatus" class="message is-error">{{ rootsStatus }}</p>
        <p v-else-if="rootsPending" class="message">Loading</p>
        <ul v-else-if="roots.length > 0" class="root-list">
          <li v-for="root in roots" :key="root.id" class="root">
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
                type="button"
                class="is-danger"
                :disabled="deletingRootId === root.id"
                @click="removeRoot(root.id)"
              >
                {{ deletingRootId === root.id ? "Removing" : "Remove" }}
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="message">No roots</p>
      </section>

      <section id="jobs" class="group" aria-labelledby="library-jobs-title">
        <div class="subhead">
          <h3 id="library-jobs-title">Jobs</h3>
          <button
            type="button"
            :disabled="isRefreshingJobs"
            @click="refreshJobList"
          >
            {{ isRefreshingJobs ? "Refreshing" : "Refresh jobs" }}
          </button>
        </div>
        <p v-if="jobMessage" class="message" aria-live="polite">
          {{ jobMessage }}
        </p>
        <p v-if="jobsStatus" class="message is-error">{{ jobsStatus }}</p>
        <p v-else-if="jobsPending" class="message">Loading</p>
        <ul v-else-if="recentJobs.length > 0" class="job-list">
          <li v-for="job in recentJobs" :key="job.id" class="job">
            <span
              class="badge"
              :class="{
                'is-active': getJobTone(job.status) === 'active',
                'is-success': getJobTone(job.status) === 'success',
                'is-danger': getJobTone(job.status) === 'danger'
              }"
            >
              {{ getJobStatusLabel(job.status) }}
            </span>
            <span class="path">{{ getScanJobPath(job) ?? job.type }}</span>
            <button
              v-if="job.canCancel"
              class="cancel-button"
              type="button"
              :disabled="cancellingJobId !== null"
              @click="cancelScanJob(job.id)"
            >
              {{ cancellingJobId === job.id ? "Cancelling" : "Cancel" }}
            </button>
            <progress
              class="progress"
              max="100"
              :value="job.progress"
              :aria-label="`${getJobStatusLabel(job.status)} ${job.progress}%`"
            />
            <span v-if="job.error" class="message is-error">
              {{ job.error }}
            </span>
            <span v-else-if="getScanJobSummary(job)" class="message">
              {{ getScanJobSummary(job) }}
            </span>
          </li>
        </ul>
        <p v-else class="message">No jobs</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.manager {
  display: grid;
  gap: 1rem;
  scroll-margin-top: 5rem;
}

#jobs {
  scroll-margin-top: 5rem;
}

.head,
.subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.head h2,
.group h3 {
  margin: 0;
}

.head h2 {
  font-size: 1.15rem;
}

.group h3 {
  font-size: 1rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: end;
  padding: 0.85rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}

.field {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.field span {
  color: var(--muted);
  font-size: 0.9rem;
}

.field input {
  width: 100%;
  min-height: 2.5rem;
  padding: 0 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel);
}

.form button,
.actions button,
.subhead button,
.root-actions button,
.cancel-button {
  min-height: 2.5rem;
  padding: 0 0.85rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel);
  cursor: pointer;
}

.form button {
  color: #fff;
  background: var(--accent);
}

.form button:disabled,
.actions button:disabled,
.subhead button:disabled,
.root-actions button:disabled,
.cancel-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.8fr);
  gap: 1rem;
  align-items: start;
}

.group {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.root-list,
.job-list {
  display: grid;
  gap: 0.5rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.root,
.job {
  display: grid;
  gap: 0.65rem;
  min-width: 0;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}

.root {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.root-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.5rem;
}

.path {
  min-width: 0;
  overflow-wrap: anywhere;
}

.job {
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
}

.cancel-button {
  justify-self: end;
}

.job .message,
.progress {
  grid-column: 1 / -1;
}

.badge {
  display: inline-flex;
  align-items: center;
  min-block-size: 1.5rem;
  padding: 0 0.45rem;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.2;
}

.is-active {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  color: var(--text);
  background: color-mix(in oklab, var(--accent) 10%, transparent);
}

.is-success {
  border-color: color-mix(in oklab, var(--success) 40%, var(--line));
  color: var(--success);
  background: color-mix(in oklab, var(--success) 9%, transparent);
}

.is-danger {
  border-color: color-mix(in oklab, var(--danger) 45%, var(--line));
  color: var(--danger);
  background: color-mix(in oklab, var(--danger) 9%, transparent);
}

.progress {
  width: 100%;
  accent-color: var(--accent);
}

.message {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.is-error {
  color: var(--danger);
}

@media (max-width: 760px) {
  .form,
  .grid {
    grid-template-columns: 1fr;
  }

  .form button {
    width: 100%;
  }
}
</style>
