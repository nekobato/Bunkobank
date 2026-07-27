<script setup lang="ts">
/**
 * Library registration, scan, job, and removal controls.
 *
 * @module
 */

import type {
  BackgroundJobResponse,
  LibraryResponse
} from "@bookcafe/contracts";
import { useIntervalFn } from "@vueuse/core";

import { getApiErrorMessage } from "../utils/apiErrors";
import {
  getJobStatusLabel,
  getJobTone,
  getScanJobFailureCount,
  getScanJobSummary,
  hasActiveJobs,
  listRecentJobs
} from "../utils/libraryJobs";

type FeedbackSeverity = "success" | "info" | "warn" | "error";

const emit = defineEmits<{
  updated: [];
}>();
const {
  cancelJob,
  createLibrary,
  createScanJob,
  deleteLibrary,
  listJobs,
  updateLibrary
} = useBookApi();
const {
  libraries,
  refreshLibraries,
  selectCreatedLibrary,
  selectedLibrary,
  selectedLibraryId,
  selectLibrary
} = useLibraries();
const name = ref("");
const rootPath = ref("");
const jobs = ref<BackgroundJobResponse[]>([]);
const jobsPending = ref(false);
const jobsError = ref("");
const message = ref("");
const messageSeverity = ref<FeedbackSeverity>("info");
const isCreating = ref(false);
const scanningLibraryId = ref<string | null>(null);
const cancellingJobId = ref<string | null>(null);
const editingLibrary = ref<LibraryResponse | null>(null);
const deletingLibrary = ref<LibraryResponse | null>(null);
const failureDialogJob = ref<BackgroundJobResponse | null>(null);
const failureDialogVisible = ref(false);
const editName = ref("");
const editRootPath = ref("");
const isSavingEdit = ref(false);
const isDeleting = ref(false);
const recentJobs = computed(() => listRecentJobs(jobs.value));
const activeJobs = computed(() => hasActiveJobs(jobs.value));

const { pause, resume, isActive } = useIntervalFn(refreshJobs, 2500, {
  immediate: false
});

watch(
  selectedLibraryId,
  () => {
    failureDialogVisible.value = false;
    failureDialogJob.value = null;
    void refreshJobs();
  },
  { immediate: true }
);

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

/** Registers a named library and makes it the active selection. */
const submitLibrary = async (): Promise<void> => {
  isCreating.value = true;
  message.value = "";

  try {
    const library = await createLibrary({
      name: name.value,
      rootPath: rootPath.value
    });
    name.value = "";
    rootPath.value = "";
    await selectCreatedLibrary(library.id);
    messageSeverity.value = "success";
    message.value = "ライブラリを追加しました。";
    emit("updated");
  } catch (error) {
    messageSeverity.value = "error";
    message.value = getApiErrorMessage(
      error,
      "ライブラリを追加できませんでした。"
    );
  } finally {
    isCreating.value = false;
  }
};

/** Opens the edit dialog with one library's persisted values. */
const openEditDialog = (library: LibraryResponse): void => {
  editingLibrary.value = library;
  editName.value = library.name;
  editRootPath.value = library.rootPath;
};

/** Saves the edited name and target directory. */
const submitLibraryEdit = async (): Promise<void> => {
  if (!editingLibrary.value) {
    return;
  }

  isSavingEdit.value = true;
  message.value = "";

  try {
    await updateLibrary(editingLibrary.value.id, {
      name: editName.value,
      rootPath: editRootPath.value
    });
    editingLibrary.value = null;
    await refreshLibraries();
    messageSeverity.value = "success";
    message.value = "ライブラリを更新しました。";
    emit("updated");
  } catch (error) {
    messageSeverity.value = "error";
    message.value = getApiErrorMessage(
      error,
      "ライブラリを更新できませんでした。"
    );
  } finally {
    isSavingEdit.value = false;
  }
};

/** Starts a scan for one library. */
const scanLibrary = async (libraryId: string): Promise<void> => {
  scanningLibraryId.value = libraryId;
  message.value = "";

  try {
    await selectLibrary(libraryId);
    await createScanJob(libraryId);
    await refreshJobs();
    messageSeverity.value = "success";
    message.value = "スキャンを開始しました。";
  } catch (error) {
    messageSeverity.value = "error";
    message.value = getApiErrorMessage(
      error,
      "スキャンを開始できませんでした。"
    );
  } finally {
    scanningLibraryId.value = null;
  }
};

/** Cancels one queued or running scan. */
const cancelScanJob = async (jobId: string): Promise<void> => {
  if (!selectedLibraryId.value) {
    return;
  }

  cancellingJobId.value = jobId;
  message.value = "";

  try {
    await cancelJob(selectedLibraryId.value, jobId);
    await refreshJobs();
    messageSeverity.value = "success";
    message.value = "スキャンをキャンセルしました。";
  } catch (error) {
    messageSeverity.value = "error";
    message.value = getApiErrorMessage(
      error,
      "スキャンをキャンセルできませんでした。"
    );
  } finally {
    cancellingJobId.value = null;
  }
};

/** Opens the paginated failure diagnostics for one completed scan. */
const openScanFailures = (job: BackgroundJobResponse): void => {
  failureDialogJob.value = job;
  failureDialogVisible.value = true;
};

/** Removes one library record without modifying its target directory. */
const confirmLibraryDeletion = async (): Promise<void> => {
  if (!deletingLibrary.value) {
    return;
  }

  isDeleting.value = true;
  message.value = "";

  try {
    await deleteLibrary(deletingLibrary.value.id);
    deletingLibrary.value = null;
    await refreshLibraries();
    await refreshJobs();
    messageSeverity.value = "success";
    message.value = "ライブラリを削除しました。";
    emit("updated");
  } catch (error) {
    messageSeverity.value = "error";
    message.value = getApiErrorMessage(
      error,
      "ライブラリを削除できませんでした。"
    );
  } finally {
    isDeleting.value = false;
  }
};

/** Reloads jobs for the current library. */
async function refreshJobs(): Promise<void> {
  const libraryId = selectedLibraryId.value;

  if (!libraryId) {
    jobs.value = [];
    jobsError.value = "";
    return;
  }

  jobsPending.value = true;
  jobsError.value = "";

  try {
    jobs.value = (await listJobs(libraryId)).jobs;
  } catch (error) {
    jobsError.value = getApiErrorMessage(
      error,
      "ジョブを読み込めませんでした。"
    );
  } finally {
    jobsPending.value = false;
  }
}

/** Maps a job state to its PrimeVue tag severity. */
const getJobSeverity = (
  status: BackgroundJobResponse["status"]
): "secondary" | "info" | "success" | "danger" => {
  switch (getJobTone(status)) {
    case "active":
      return "info";
    case "success":
      return "success";
    case "danger":
      return "danger";
    default:
      return "secondary";
  }
};
</script>

<template>
  <section class="manager" aria-labelledby="libraries-title">
    <header class="manager-heading">
      <h2 id="libraries-title">ライブラリ</h2>
      <Button
        label="更新"
        icon="pi pi-refresh"
        severity="secondary"
        variant="text"
        @click="refreshLibraries"
      />
    </header>

    <form class="create-form" @submit.prevent="submitLibrary">
      <div class="field">
        <label for="library-name">名前</label>
        <InputText
          id="library-name"
          v-model="name"
          name="name"
          autocomplete="off"
          maxlength="100"
          required
          fluid
        />
      </div>
      <div class="field path-field">
        <label for="library-root-path">対象ディレクトリ</label>
        <InputText
          id="library-root-path"
          v-model="rootPath"
          name="rootPath"
          autocomplete="off"
          required
          fluid
        />
      </div>
      <Button
        label="追加"
        icon="pi pi-plus"
        type="submit"
        :loading="isCreating"
      />
    </form>

    <Message
      v-if="message"
      :severity="messageSeverity"
      :closable="false"
      aria-live="polite"
    >
      {{ message }}
    </Message>

    <ul v-if="libraries.length > 0" class="library-list">
      <li
        v-for="library in libraries"
        :key="library.id"
        class="library-row"
        :class="{ 'is-selected': library.id === selectedLibraryId }"
      >
        <button
          class="library-label"
          type="button"
          @click="selectLibrary(library.id)"
        >
          <strong>{{ library.name }}</strong>
          <code>{{ library.rootPath }}</code>
        </button>
        <div class="row-actions">
          <Button
            label="スキャン"
            icon="pi pi-sync"
            size="small"
            :loading="scanningLibraryId === library.id"
            @click="scanLibrary(library.id)"
          />
          <Button
            label="編集"
            icon="pi pi-pencil"
            size="small"
            severity="secondary"
            variant="outlined"
            @click="openEditDialog(library)"
          />
          <Button
            label="削除"
            icon="pi pi-trash"
            size="small"
            severity="danger"
            variant="text"
            @click="deletingLibrary = library"
          />
        </div>
      </li>
    </ul>
    <p v-else class="empty">ライブラリは未登録です。</p>

    <Card v-if="selectedLibrary" class="jobs">
      <template #title>
        <div class="jobs-heading">
          <span>ジョブ</span>
          <Button
            label="更新"
            icon="pi pi-refresh"
            size="small"
            severity="secondary"
            variant="text"
            :loading="jobsPending"
            @click="refreshJobs"
          />
        </div>
      </template>
      <template #content>
        <Message v-if="jobsError" severity="error" :closable="false">
          {{ jobsError }}
        </Message>
        <ul v-else-if="recentJobs.length > 0" class="job-list">
          <li v-for="job in recentJobs" :key="job.id" class="job-row">
            <Tag
              :value="getJobStatusLabel(job.status)"
              :severity="getJobSeverity(job.status)"
              rounded
            />
            <span>{{ getScanJobSummary(job) ?? "スキャン" }}</span>
            <div
              v-if="job.canCancel || getScanJobFailureCount(job) > 0"
              class="job-actions"
            >
              <Button
                v-if="getScanJobFailureCount(job) > 0"
                label="詳細"
                size="small"
                severity="secondary"
                variant="text"
                aria-controls="scan-failure-dialog"
                :aria-expanded="
                  failureDialogVisible && failureDialogJob?.id === job.id
                "
                @click="openScanFailures(job)"
              />
              <Button
                v-if="job.canCancel"
                label="キャンセル"
                size="small"
                severity="danger"
                variant="text"
                :loading="cancellingJobId === job.id"
                :disabled="cancellingJobId !== null"
                @click="cancelScanJob(job.id)"
              />
            </div>
            <ProgressBar
              :value="job.progress"
              :show-value="false"
              :aria-label="`${getJobStatusLabel(job.status)} ${job.progress}%`"
            />
            <small v-if="job.error">{{ job.error }}</small>
          </li>
        </ul>
        <p v-else class="empty">ジョブはありません。</p>
      </template>
    </Card>

    <Dialog
      :visible="editingLibrary !== null"
      modal
      header="ライブラリを編集"
      :style="{ width: 'min(34rem, calc(100vw - 2rem))' }"
      @update:visible="editingLibrary = null"
    >
      <form
        id="library-edit-form"
        class="dialog-form"
        @submit.prevent="submitLibraryEdit"
      >
        <div class="field">
          <label for="library-edit-name">名前</label>
          <InputText
            id="library-edit-name"
            v-model="editName"
            name="name"
            autocomplete="off"
            maxlength="100"
            required
            fluid
          />
        </div>
        <div class="field">
          <label for="library-edit-path">対象ディレクトリ</label>
          <InputText
            id="library-edit-path"
            v-model="editRootPath"
            name="rootPath"
            autocomplete="off"
            required
            fluid
          />
        </div>
      </form>
      <template #footer>
        <Button
          label="キャンセル"
          severity="secondary"
          variant="text"
          @click="editingLibrary = null"
        />
        <Button
          form="library-edit-form"
          label="保存"
          type="submit"
          :loading="isSavingEdit"
        />
      </template>
    </Dialog>

    <Dialog
      :visible="deletingLibrary !== null"
      modal
      header="ライブラリを削除"
      :style="{ width: 'min(30rem, calc(100vw - 2rem))' }"
      @update:visible="deletingLibrary = null"
    >
      <p class="dialog-copy">
        「{{
          deletingLibrary?.name
        }}」の管理データを削除します。原本は削除しません。
      </p>
      <template #footer>
        <Button
          label="キャンセル"
          severity="secondary"
          variant="text"
          @click="deletingLibrary = null"
        />
        <Button
          label="削除"
          severity="danger"
          :loading="isDeleting"
          @click="confirmLibraryDeletion"
        />
      </template>
    </Dialog>

    <ScanFailureDialog
      v-if="failureDialogJob && selectedLibrary"
      v-model="failureDialogVisible"
      :library-id="selectedLibrary.id"
      :job-id="failureDialogJob.id"
      :expected-count="getScanJobFailureCount(failureDialogJob)"
    />
  </section>
</template>

<style scoped>
.manager {
  display: grid;
  gap: 1rem;
}

.manager-heading,
.jobs-heading,
.row-actions,
.job-actions {
  display: flex;
  align-items: center;
}

.manager-heading,
.jobs-heading {
  justify-content: space-between;
  gap: 1rem;
}

.manager-heading h2 {
  margin: 0;
  font-family: var(--bc-font-display);
  font-size: 1.15rem;
}

.create-form {
  display: grid;
  grid-template-columns: minmax(10rem, 0.55fr) minmax(16rem, 1.45fr) auto;
  align-items: end;
  gap: 0.75rem;
  border: 1px solid var(--bc-line-soft);
  border-radius: 0.8rem;
  background: var(--bc-paper);
  padding: 1rem;
}

.field,
.dialog-form {
  display: grid;
  gap: 0.4rem;
}

.field {
  min-inline-size: 0;
}

.field label {
  color: var(--bc-ink-soft);
  font-size: 0.78rem;
  font-weight: 700;
}

.library-list,
.job-list {
  display: grid;
  gap: 0.6rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.library-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  border: 1px solid var(--bc-line-soft);
  border-inline-start: 0.3rem solid transparent;
  border-radius: 0.7rem;
  background: var(--bc-panel);
  padding: 0.75rem;
}

.library-row.is-selected {
  border-inline-start-color: var(--bc-ink-blue);
}

.library-label {
  display: grid;
  gap: 0.3rem;
  min-inline-size: 0;
  border: 0;
  color: var(--bc-ink);
  background: transparent;
  padding: 0.25rem;
  text-align: start;
  cursor: pointer;
}

.library-label code {
  overflow: hidden;
  color: var(--bc-ink-soft);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.4rem;
}

.job-actions {
  justify-content: end;
  gap: 0.25rem;
}

.jobs {
  border-color: var(--bc-line-soft);
  box-shadow: none;
}

.jobs :deep(.p-card-content) {
  display: grid;
  gap: 0.75rem;
}

.job-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
}

.job-row :deep(.p-progressbar),
.job-row small {
  grid-column: 1 / -1;
}

.job-row small {
  color: var(--bc-danger);
}

.empty,
.dialog-copy {
  margin: 0;
  color: var(--bc-ink-soft);
}

.dialog-form {
  gap: 1rem;
}

@media (width <= 48rem) {
  .create-form,
  .library-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .row-actions {
    justify-content: start;
  }
}
</style>
