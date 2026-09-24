<script setup lang="ts">
/**
 * Library registration, scan, job, and removal controls.
 *
 * @module
 */

import type {
  BackgroundJobResponse,
  LibraryResponse
} from "@bunkobank/contracts";
import { libraryUpdateRequestSchema } from "@bunkobank/contracts";
import { useIntervalFn } from "@vueuse/core";

import { getApiErrorMessage } from "../utils/apiErrors";
import {
  createFieldErrorMap,
  focusFormErrorSummary
} from "../utils/formValidation";
import {
  findActiveScanJob,
  getJobStatusLabel,
  getJobTone,
  getScanJobFailureCount,
  getScanJobSummary,
  hasActiveJobs,
  listRecentJobs
} from "../utils/libraryJobs";

type FeedbackType = "success" | "info" | "warning" | "error";

const emit = defineEmits<{
  updated: [];
}>();
const {
  cancelJob,
  createScanJob,
  deleteLibrary,
  importLibraryBook,
  lockLibrary,
  listJobs,
  unlockLibrary,
  updateLibrary
} = useBookApi();
const {
  error: libraryError,
  libraries,
  loaded: librariesLoaded,
  loading: librariesLoading,
  refreshLibraries,
  selectCreatedLibrary,
  selectedLibrary,
  selectedLibraryId,
  selectLibrary
} = useLibraries();
const allJobs = ref<BackgroundJobResponse[]>([]);
const jobsPending = ref(false);
const jobsError = ref("");
const message = ref("");
const messageType = ref<FeedbackType>("info");
const createDrawerVisible = ref(false);
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
const editFieldErrors = ref<Record<string, string>>({});
const editErrorSummary = useTemplateRef<HTMLElement>("edit-error-summary");
const unlockingLibrary = ref<LibraryResponse | null>(null);
const unlockPassword = ref("");
const isUnlocking = ref(false);
const unlockError = ref("");
const importTargetLibraryId = ref<string | null>(null);
const importProgress = ref<{ current: number; total: number } | null>(null);
const importingLibraryId = ref<string | null>(null);
const libraryFileInput = useTemplateRef<HTMLInputElement>("library-file-input");
const jobs = computed(() =>
  selectedLibraryId.value
    ? allJobs.value.filter(
        ({ libraryId }) => libraryId === selectedLibraryId.value
      )
    : []
);
const recentJobs = computed(() => listRecentJobs(jobs.value));
const activeJobs = computed(() => hasActiveJobs(allJobs.value));

const { pause, resume, isActive } = useIntervalFn(refreshJobs, 2500, {
  immediate: false
});

watch(
  selectedLibraryId,
  () => {
    failureDialogVisible.value = false;
    failureDialogJob.value = null;
  },
  { immediate: true }
);

watch(
  () => libraries.value.map(({ id }) => id).join("\0"),
  () => {
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

/** Selects a newly created library and refreshes dependent page state. */
const onLibraryCreated = async (library: LibraryResponse): Promise<void> => {
  await selectCreatedLibrary(library.id);
  messageType.value = "success";
  message.value = "ライブラリを追加しました。";
  emit("updated");
};

/** Opens the edit dialog with one library's persisted values. */
const openEditDialog = (library: LibraryResponse): void => {
  editingLibrary.value = library;
  editName.value = library.name;
  editRootPath.value = library.rootPath;
  editFieldErrors.value = {};
};

/** Saves the edited name and target directory. */
const submitLibraryEdit = async (): Promise<void> => {
  if (!editingLibrary.value) {
    return;
  }

  const validation = libraryUpdateRequestSchema.safeParse(
    editingLibrary.value.kind === "encrypted"
      ? { name: editName.value }
      : { name: editName.value, rootPath: editRootPath.value }
  );

  if (!validation.success) {
    editFieldErrors.value = localizeLibraryFieldErrors(
      createFieldErrorMap(validation.error.issues)
    );
    await focusFormErrorSummary(editErrorSummary.value);
    return;
  }

  isSavingEdit.value = true;
  message.value = "";
  editFieldErrors.value = {};

  try {
    await updateLibrary(editingLibrary.value.id, validation.data);
    editingLibrary.value = null;
    await refreshLibraries();
    messageType.value = "success";
    message.value = "ライブラリを更新しました。";
    emit("updated");
  } catch (error) {
    messageType.value = "error";
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
    upsertJob(await createScanJob(libraryId));
    await refreshJobs();
    messageType.value = "success";
    message.value = "スキャンを開始しました。";
  } catch (error) {
    messageType.value = "error";
    message.value = getApiErrorMessage(
      error,
      "スキャンを開始できませんでした。"
    );
  } finally {
    scanningLibraryId.value = null;
  }
};

/** Cancels one queued or running scan. */
const cancelScanJob = async (
  libraryId: string,
  jobId: string
): Promise<void> => {
  cancellingJobId.value = jobId;
  message.value = "";

  try {
    upsertJob(await cancelJob(libraryId, jobId));
    await refreshJobs();
    messageType.value = "success";
    message.value = "スキャンを停止しました。";
  } catch (error) {
    messageType.value = "error";
    message.value = getApiErrorMessage(
      error,
      "スキャンを停止できませんでした。"
    );
  } finally {
    cancellingJobId.value = null;
  }
};

/** Starts or stops the scan associated with one library row. */
const toggleLibraryScan = async (libraryId: string): Promise<void> => {
  const activeJob = getActiveScanJob(libraryId);

  if (activeJob) {
    await cancelScanJob(libraryId, activeJob.id);
    return;
  }

  await scanLibrary(libraryId);
};

/** Returns the queued or running scan for one library. */
const getActiveScanJob = (libraryId: string): BackgroundJobResponse | null =>
  findActiveScanJob(allJobs.value, libraryId);

/** Prevents library mutations while a scan is starting or active. */
const isLibraryScanning = (libraryId: string): boolean =>
  scanningLibraryId.value === libraryId || getActiveScanJob(libraryId) !== null;

/** Returns whether one library's active scan is being stopped. */
const isStoppingLibraryScan = (libraryId: string): boolean =>
  cancellingJobId.value === getActiveScanJob(libraryId)?.id;

/** Returns whether one library's scan action is waiting for the API. */
const isUpdatingLibraryScan = (libraryId: string): boolean =>
  scanningLibraryId.value === libraryId || isStoppingLibraryScan(libraryId);

/** Opens a native file picker for one unlocked encrypted library. */
const openImportPicker = (libraryId: string): void => {
  importTargetLibraryId.value = libraryId;
  libraryFileInput.value?.click();
};

/** Imports each selected book sequentially so progress remains comprehensible. */
const importSelectedBooks = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  const libraryId = importTargetLibraryId.value;
  input.value = "";

  if (!libraryId || files.length === 0) {
    return;
  }

  importingLibraryId.value = libraryId;
  importProgress.value = { current: 0, total: files.length };
  message.value = "";

  try {
    for (const [index, file] of files.entries()) {
      await importLibraryBook(libraryId, file);
      importProgress.value = { current: index + 1, total: files.length };
    }
    await refreshLibraries();
    messageType.value = "success";
    message.value = `${files.length}冊を追加しました。`;
    emit("updated");
  } catch (error) {
    messageType.value = "error";
    message.value = getApiErrorMessage(
      error,
      "ファイルを追加できませんでした。"
    );
  } finally {
    importingLibraryId.value = null;
    importProgress.value = null;
    importTargetLibraryId.value = null;
  }
};

/** Clears one library's in-memory encryption key. */
const lockEncryptedLibrary = async (
  library: LibraryResponse
): Promise<void> => {
  message.value = "";

  try {
    await lockLibrary(library.id);
    await refreshLibraries();
    messageType.value = "success";
    message.value = "ライブラリをロックしました。";
  } catch (error) {
    messageType.value = "error";
    message.value = getApiErrorMessage(
      error,
      "ライブラリをロックできませんでした。"
    );
  }
};

/** Opens password entry for a locked encrypted library. */
const openUnlockDialog = (library: LibraryResponse): void => {
  unlockingLibrary.value = library;
  unlockPassword.value = "";
  unlockError.value = "";
};

/** Unlocks an encrypted library using its independently chosen password. */
const submitLibraryUnlock = async (): Promise<void> => {
  if (!unlockingLibrary.value) {
    return;
  }

  isUnlocking.value = true;
  unlockError.value = "";

  try {
    await unlockLibrary(unlockingLibrary.value.id, {
      password: unlockPassword.value
    });
    unlockingLibrary.value = null;
    unlockPassword.value = "";
    await refreshLibraries();
    messageType.value = "success";
    message.value = "ライブラリをロック解除しました。";
  } catch (error) {
    unlockError.value = getApiErrorMessage(
      error,
      "ロック解除できませんでした。"
    );
  } finally {
    isUnlocking.value = false;
  }
};

/** Replaces one locally cached job with its newest API representation. */
const upsertJob = (updatedJob: BackgroundJobResponse): void => {
  allJobs.value = [
    updatedJob,
    ...allJobs.value.filter(({ id }) => id !== updatedJob.id)
  ];
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
    messageType.value = "success";
    message.value = "ライブラリを削除しました。";
    emit("updated");
  } catch (error) {
    messageType.value = "error";
    message.value = getApiErrorMessage(
      error,
      "ライブラリを削除できませんでした。"
    );
  } finally {
    isDeleting.value = false;
  }
};

/** Reloads jobs for every configured library. */
async function refreshJobs(): Promise<void> {
  const libraryIds = libraries.value.map(({ id }) => id);

  if (libraryIds.length === 0) {
    allJobs.value = [];
    jobsError.value = "";
    return;
  }

  jobsPending.value = true;
  jobsError.value = "";

  try {
    const responses = await Promise.all(
      libraryIds.map((libraryId) => listJobs(libraryId))
    );
    allJobs.value = responses.flatMap(({ jobs: libraryJobs }) => libraryJobs);
  } catch (error) {
    jobsError.value = getApiErrorMessage(
      error,
      "ジョブを読み込めませんでした。"
    );
  } finally {
    jobsPending.value = false;
  }
}

/** Maps a job state to its Element Plus tag type. */
const getJobType = (
  status: BackgroundJobResponse["status"]
): "info" | "success" | "danger" => {
  switch (getJobTone(status)) {
    case "active":
      return "info";
    case "success":
      return "success";
    case "danger":
      return "danger";
    default:
      return "info";
  }
};

/**
 * Converts shared schema messages into stable Japanese library guidance.
 */
const localizeLibraryFieldErrors = (
  errors: Record<string, string>
): Record<string, string> => ({
  ...(errors.name ? { name: "名前を1〜100文字で入力してください。" } : {}),
  ...(errors.rootPath
    ? { rootPath: "対象ディレクトリを入力してください。" }
    : {}),
  ...(errors.form ? { form: "入力内容を確認してください。" } : {})
});
</script>

<template>
  <section class="manager" aria-labelledby="libraries-title">
    <header class="manager-heading">
      <h2 id="libraries-title">ライブラリ</h2>
      <div class="heading-actions">
        <ElButton :icon="ElIconPlus" @click="createDrawerVisible = true">
          ライブラリを追加
        </ElButton>
        <ElButton
          :icon="ElIconRefresh"
          type="info"
          text
          @click="refreshLibraries"
        >
          更新
        </ElButton>
      </div>
    </header>

    <input
      ref="library-file-input"
      class="visually-hidden"
      type="file"
      multiple
      accept=".zip,.cbz,.pdf,.epub,.rar,.cbr,.7z"
      @change="importSelectedBooks"
    />

    <LibraryCreateDrawer
      v-model:open="createDrawerVisible"
      @created="onLibraryCreated"
    />

    <ElAlert
      v-if="message"
      :type="messageType"
      :closable="false"
      show-icon
      aria-live="polite"
    >
      {{ message }}
    </ElAlert>

    <ElAlert v-if="libraryError" type="error" :closable="false" show-icon>
      {{
        getApiErrorMessage(libraryError, "ライブラリを読み込めませんでした。")
      }}
    </ElAlert>
    <div v-else-if="librariesLoading" class="loading" role="status">
      <LoadingIndicator class="spinner" />
    </div>
    <ul v-else-if="libraries.length > 0" class="library-list">
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
          <span class="library-title">
            <strong>{{ library.name }}</strong>
            <ElTag
              v-if="library.kind === 'directory'"
              type="info"
              effect="plain"
              round
            >
              フォルダー参照
            </ElTag>
            <ElTag
              v-else
              :type="library.lockState === 'unlocked' ? 'success' : 'info'"
              effect="plain"
              round
            >
              {{
                library.lockState === "unlocked"
                  ? "暗号化・解除済み"
                  : "暗号化・ロック中"
              }}
            </ElTag>
            <ElTag
              v-if="
                library.kind === 'directory' && getActiveScanJob(library.id)
              "
              type="info"
              round
            >
              スキャン中
            </ElTag>
          </span>
          <code>{{ library.rootPath }}</code>
        </button>
        <div class="row-actions">
          <ElButton
            v-if="library.kind === 'directory'"
            :icon="
              getActiveScanJob(library.id) ? ElIconVideoPause : ElIconRefresh
            "
            size="small"
            :type="getActiveScanJob(library.id) ? 'danger' : undefined"
            :loading="isUpdatingLibraryScan(library.id)"
            :disabled="isStoppingLibraryScan(library.id)"
            @click="toggleLibraryScan(library.id)"
          >
            {{ getActiveScanJob(library.id) ? "スキャン停止" : "スキャン" }}
          </ElButton>
          <template v-else>
            <ElButton
              v-if="library.lockState === 'unlocked'"
              :icon="ElIconUpload"
              size="small"
              :loading="importingLibraryId === library.id"
              :disabled="importingLibraryId !== null"
              @click="openImportPicker(library.id)"
            >
              ファイルを追加
            </ElButton>
            <ElButton
              v-if="library.lockState === 'unlocked'"
              :icon="ElIconLock"
              size="small"
              type="info"
              plain
              :disabled="importingLibraryId === library.id"
              @click="lockEncryptedLibrary(library)"
            >
              ロック
            </ElButton>
            <ElButton
              v-else
              :icon="ElIconUnlock"
              size="small"
              @click="openUnlockDialog(library)"
            >
              ロック解除
            </ElButton>
          </template>
          <ElButton
            :icon="ElIconEdit"
            size="small"
            type="info"
            plain
            circle
            :aria-label="`${library.name}を編集`"
            :disabled="
              library.kind === 'directory' && isLibraryScanning(library.id)
            "
            @click="openEditDialog(library)"
          />
          <ElButton
            :icon="ElIconDelete"
            size="small"
            type="danger"
            text
            circle
            :aria-label="`${library.name}を削除`"
            :disabled="
              library.kind === 'directory' && isLibraryScanning(library.id)
            "
            @click="deletingLibrary = library"
          />
        </div>
        <p
          v-if="importingLibraryId === library.id && importProgress"
          class="import-progress"
          role="status"
        >
          {{ importProgress.current }} /
          {{ importProgress.total }} 冊を暗号化しています
        </p>
      </li>
    </ul>
    <p v-else-if="librariesLoaded" class="empty">ライブラリは未登録です。</p>

    <ElCard v-if="selectedLibrary?.kind === 'directory'" class="jobs">
      <template #header>
        <div class="jobs-heading">
          <span>ジョブ</span>
          <ElButton
            :icon="ElIconRefresh"
            size="small"
            type="info"
            text
            :loading="jobsPending"
            @click="refreshJobs"
          >
            更新
          </ElButton>
        </div>
      </template>
      <template #default>
        <ElAlert v-if="jobsError" type="error" :closable="false" show-icon>
          {{ jobsError }}
        </ElAlert>
        <ul v-else-if="recentJobs.length > 0" class="job-list">
          <li v-for="job in recentJobs" :key="job.id" class="job-row">
            <ElTag :type="getJobType(job.status)" round>
              {{ getJobStatusLabel(job.status) }}
            </ElTag>
            <span>{{ getScanJobSummary(job) ?? "スキャン" }}</span>
            <div
              v-if="job.canCancel || getScanJobFailureCount(job) > 0"
              class="job-actions"
            >
              <ElButton
                v-if="getScanJobFailureCount(job) > 0"
                size="small"
                type="info"
                text
                aria-controls="scan-failure-dialog"
                :aria-expanded="
                  failureDialogVisible && failureDialogJob?.id === job.id
                "
                @click="openScanFailures(job)"
              >
                詳細
              </ElButton>
              <ElButton
                v-if="job.canCancel"
                size="small"
                type="danger"
                text
                :loading="cancellingJobId === job.id"
                :disabled="cancellingJobId !== null"
                @click="cancelScanJob(job.libraryId, job.id)"
              >
                キャンセル
              </ElButton>
            </div>
            <ElProgress
              :percentage="job.progress"
              :show-text="false"
              :aria-label="`${getJobStatusLabel(job.status)} ${job.progress}%`"
            />
            <small v-if="job.error">{{ job.error }}</small>
          </li>
        </ul>
        <p v-else class="empty">ジョブはありません。</p>
      </template>
    </ElCard>

    <ElDialog
      :model-value="editingLibrary !== null"
      title="ライブラリを編集"
      width="min(34rem, calc(100vw - 2rem))"
      @update:model-value="editingLibrary = null"
    >
      <form
        id="library-edit-form"
        class="dialog-form"
        @submit.prevent="submitLibraryEdit"
      >
        <div
          v-if="Object.keys(editFieldErrors).length > 0"
          ref="edit-error-summary"
          class="error-summary"
          tabindex="-1"
          role="alert"
        >
          <strong>入力内容を確認してください。</strong>
          <a v-if="editFieldErrors.name" href="#library-edit-name">
            {{ editFieldErrors.name }}
          </a>
          <a
            v-if="
              editingLibrary?.kind === 'directory' && editFieldErrors.rootPath
            "
            href="#library-edit-path"
          >
            {{ editFieldErrors.rootPath }}
          </a>
        </div>
        <div class="field">
          <label for="library-edit-name">名前</label>
          <ElInput
            id="library-edit-name"
            v-model="editName"
            name="name"
            autocomplete="off"
            maxlength="100"
            required
            :aria-invalid="Boolean(editFieldErrors.name)"
            aria-describedby="library-edit-name-error"
            class="fluid-control"
            :class="{ 'is-invalid': Boolean(editFieldErrors.name) }"
          />
          <small
            v-if="editFieldErrors.name"
            id="library-edit-name-error"
            class="field-error"
          >
            {{ editFieldErrors.name }}
          </small>
        </div>
        <div v-if="editingLibrary?.kind === 'directory'" class="field">
          <label for="library-edit-path">対象ディレクトリ</label>
          <ElInput
            id="library-edit-path"
            v-model="editRootPath"
            name="rootPath"
            autocomplete="off"
            required
            :aria-invalid="Boolean(editFieldErrors.rootPath)"
            aria-describedby="library-edit-path-error"
            class="fluid-control"
            :class="{ 'is-invalid': Boolean(editFieldErrors.rootPath) }"
          />
          <small
            v-if="editFieldErrors.rootPath"
            id="library-edit-path-error"
            class="field-error"
          >
            {{ editFieldErrors.rootPath }}
          </small>
        </div>
      </form>
      <template #footer>
        <ElButton type="info" text @click="editingLibrary = null">
          キャンセル
        </ElButton>
        <ElButton
          form="library-edit-form"
          native-type="submit"
          :loading="isSavingEdit"
        >
          保存
        </ElButton>
      </template>
    </ElDialog>

    <ElDialog
      :model-value="unlockingLibrary !== null"
      title="ライブラリをロック解除"
      width="min(30rem, calc(100vw - 2rem))"
      @update:model-value="unlockingLibrary = null"
    >
      <form
        id="library-unlock-form"
        class="dialog-form"
        @submit.prevent="submitLibraryUnlock"
      >
        <div v-if="unlockError" class="error-summary" role="alert">
          {{ unlockError }}
        </div>
        <div class="field">
          <label for="library-unlock-password">パスワード</label>
          <ElInput
            id="library-unlock-password"
            v-model="unlockPassword"
            name="password"
            type="password"
            autocomplete="current-password"
            minlength="1"
            maxlength="128"
            required
            show-password
            autofocus
          />
        </div>
      </form>
      <template #footer>
        <ElButton
          type="info"
          text
          :disabled="isUnlocking"
          @click="unlockingLibrary = null"
        >
          キャンセル
        </ElButton>
        <ElButton
          form="library-unlock-form"
          native-type="submit"
          :loading="isUnlocking"
        >
          ロック解除
        </ElButton>
      </template>
    </ElDialog>

    <ElDialog
      :model-value="deletingLibrary !== null"
      title="ライブラリを削除"
      width="min(30rem, calc(100vw - 2rem))"
      @update:model-value="deletingLibrary = null"
    >
      <p class="dialog-copy">
        「{{
          deletingLibrary?.name
        }}」の管理データを削除します。原本は削除しません。
      </p>
      <template #footer>
        <ElButton type="info" text @click="deletingLibrary = null">
          キャンセル
        </ElButton>
        <ElButton
          type="danger"
          :loading="isDeleting"
          @click="confirmLibraryDeletion"
        >
          削除
        </ElButton>
      </template>
    </ElDialog>

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
.job-actions,
.heading-actions {
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

.heading-actions {
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.25rem;
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

.field-error {
  color: var(--bc-danger);
  font-size: 0.72rem;
}

.error-summary {
  display: grid;
  gap: 0.35rem;
  border-inline-start: 0.3rem solid var(--bc-danger);
  padding: 0.75rem 1rem;
  color: var(--bc-danger);
  background: color-mix(in oklab, var(--bc-danger) 8%, var(--bc-panel));
}

.error-summary:focus {
  outline: 2px solid var(--bc-danger);
  outline-offset: 2px;
}

.error-summary a {
  color: inherit;
}

.loading {
  display: grid;
  min-block-size: 5rem;
  place-items: center;
}

.spinner {
  inline-size: 2rem;
  block-size: 2rem;
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

.import-progress {
  grid-column: 1 / -1;
  margin: -0.25rem 0 0;
  color: var(--bc-ink-soft);
  font-size: 0.78rem;
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

.library-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-inline-size: 0;
}

.library-title :deep(.el-tag) {
  font-size: 0.68rem;
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

.jobs :deep(.el-card__body) {
  display: grid;
  gap: 0.75rem;
}

.job-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
}

.job-row :deep(.el-progress),
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

.visually-hidden {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  clip-path: inset(50%);
}

.dialog-form {
  gap: 1rem;
}

@media (width <= 48rem) {
  .library-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .row-actions {
    justify-content: start;
  }
}
</style>
