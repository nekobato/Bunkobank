<script setup lang="ts">
/**
 * Paginated, path-safe diagnostics for one completed library scan.
 *
 * @module
 */

import type { ScanFailureResponse } from "@bunkobank/contracts";

import { getBookCoverFormatLabel } from "../utils/bookCover";
import { getApiErrorMessage } from "../utils/apiErrors";
import { getScanFailureCodeLabel } from "../utils/libraryJobs";

const { libraryId, jobId, expectedCount } = defineProps<{
  libraryId: string;
  jobId: string;
  expectedCount: number;
}>();
const visible = defineModel<boolean>({ required: true });
const { listScanFailures } = useBookApi();
const failures = ref<ScanFailureResponse[]>([]);
const total = ref(0);
const pending = ref(false);
const errorMessage = ref("");
const pageSize = 100;
let requestVersion = 0;
const hasMore = computed(() => failures.value.length < total.value);

/**
 * Loads the first or next bounded page without retaining one huge API response.
 */
const loadFailurePage = async (reset: boolean): Promise<void> => {
  const version = ++requestVersion;
  const offset = reset ? 0 : failures.value.length;

  if (reset) {
    failures.value = [];
    total.value = 0;
  }

  pending.value = true;
  errorMessage.value = "";

  try {
    const response = await listScanFailures(libraryId, jobId, {
      offset,
      limit: pageSize
    });

    if (version !== requestVersion) {
      return;
    }

    failures.value = reset
      ? response.failures
      : [...failures.value, ...response.failures];
    total.value = response.total;
  } catch (error) {
    if (version === requestVersion) {
      errorMessage.value = getApiErrorMessage(
        error,
        "スキャン失敗の詳細を読み込めませんでした。"
      );
    }
  } finally {
    if (version === requestVersion) {
      pending.value = false;
    }
  }
};

watch(
  [visible, () => libraryId, () => jobId],
  ([isVisible]) => {
    requestVersion += 1;

    if (!isVisible) {
      pending.value = false;
      return;
    }

    void loadFailurePage(true);
  },
  { immediate: true }
);
</script>

<template>
  <Dialog
    id="scan-failure-dialog"
    v-model:visible="visible"
    modal
    header="スキャン失敗の詳細"
    :style="{ width: '52rem' }"
    :breakpoints="{ '64rem': '80vw', '40rem': 'calc(100vw - 2rem)' }"
  >
    <div class="failure-content">
      <p class="failure-summary">
        <template v-if="total > 0">
          {{ total }}件中{{ failures.length }}件を表示
        </template>
        <template v-else>解析失敗{{ expectedCount }}件</template>
      </p>

      <Message v-if="errorMessage" severity="error" :closable="false">
        {{ errorMessage }}
      </Message>

      <p v-if="pending && failures.length === 0" class="failure-state">
        詳細を読み込んでいます。
      </p>
      <Message
        v-else-if="!errorMessage && failures.length === 0 && expectedCount > 0"
        severity="info"
        :closable="false"
      >
        このジョブは詳細記録機能の追加前に実行されたため、件数のみが残っています。
      </Message>

      <ul v-if="failures.length > 0" class="failure-list" role="list">
        <li v-for="failure in failures" :key="failure.id" class="failure-row">
          <div class="failure-heading">
            <Tag
              :value="getBookCoverFormatLabel(failure.format)"
              severity="secondary"
              rounded
            />
            <strong>{{ getScanFailureCodeLabel(failure.code) }}</strong>
          </div>
          <code>{{ failure.relativePath }}</code>
          <small v-if="failure.kind === 'subtree'">
            このディレクトリ以下を走査できませんでした。
          </small>
        </li>
      </ul>
    </div>

    <template #footer>
      <Button
        v-if="hasMore"
        label="さらに読み込む"
        severity="secondary"
        variant="text"
        :loading="pending"
        @click="loadFailurePage(false)"
      />
      <Button label="閉じる" @click="visible = false" />
    </template>
  </Dialog>
</template>

<style scoped>
.failure-content {
  display: grid;
  gap: 0.9rem;
}

.failure-summary,
.failure-state {
  margin: 0;
  color: var(--bc-ink-soft);
}

.failure-list {
  display: grid;
  gap: 0.65rem;
  max-block-size: min(60vh, 36rem);
  padding: 0;
  margin: 0;
  overflow: auto;
  list-style: none;
}

.failure-row {
  display: grid;
  gap: 0.5rem;
  border: 1px solid var(--bc-line-soft);
  border-inline-start: 0.3rem solid var(--bc-danger);
  border-radius: 0.7rem;
  background: var(--bc-panel);
  padding: 0.75rem;
}

.failure-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.failure-heading strong {
  color: var(--bc-danger);
  font-size: 0.9rem;
}

.failure-row code {
  overflow-wrap: anywhere;
  color: var(--bc-ink);
  font-size: 0.78rem;
  white-space: normal;
}

.failure-row small {
  color: var(--bc-ink-soft);
}
</style>
