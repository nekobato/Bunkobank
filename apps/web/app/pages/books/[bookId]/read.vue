<script setup lang="ts">
import { useDebounceFn, useEventListener } from "@vueuse/core";

import {
  getAccessErrorMessage,
  getApiErrorMessage
} from "../../../utils/apiErrors";

const route = useRoute("/books/[bookId]/read");
const bookId = computed(() => String(route.params.bookId));
const { selectedLibraryId } = useLibraries();
const { getBook, updateBookProgress } = useBookApi();
const { data, error, pending, refresh } = await useAsyncData(
  `book-${bookId.value}`,
  () =>
    selectedLibraryId.value
      ? getBook(selectedLibraryId.value, bookId.value)
      : Promise.resolve(null),
  {
    server: false,
    watch: [selectedLibraryId]
  }
);
const lastSavedPage = ref(1);
const pendingPage = ref<number | null>(null);
const progressError = ref("");
const statusCode = computed(() => error.value?.statusCode);
const actionLink = computed(() => {
  if (statusCode.value === 409) {
    return { label: "設定を開く", to: "/setup" };
  }

  if (statusCode.value === 401) {
    return { label: "ログイン", to: "/login" };
  }

  return null;
});
const errorMessage = computed(() =>
  getAccessErrorMessage(statusCode.value, "書籍を読み込めませんでした。")
);

useHead({
  title: () => data.value?.title ?? "ビューワー"
});

watch(
  data,
  (book) => {
    if (book) {
      lastSavedPage.value = book.currentPage;
    }
  },
  { immediate: true }
);

/**
 * Persists the latest reader page without blocking page navigation.
 */
const persistProgress = async (
  currentPage: number,
  keepalive = false
): Promise<void> => {
  if (
    !data.value ||
    !selectedLibraryId.value ||
    currentPage === lastSavedPage.value
  ) {
    return;
  }

  try {
    const book = await updateBookProgress(
      selectedLibraryId.value,
      bookId.value,
      { currentPage },
      { keepalive }
    );
    data.value = book;
    lastSavedPage.value = book.currentPage;
    progressError.value = "";
  } catch (error) {
    progressError.value = getApiErrorMessage(
      error,
      "読書位置を保存できませんでした。"
    );
  }
};

/**
 * Persists the newest pending page after navigation settles.
 */
const saveProgress = useDebounceFn(
  async (): Promise<void> => {
    const currentPage = pendingPage.value;

    if (currentPage === null) {
      return;
    }

    pendingPage.value = null;
    await persistProgress(currentPage);
  },
  500,
  { maxWait: 2000 }
);

/**
 * Flushes the newest pending page immediately before leaving the reader.
 */
const flushProgress = async (keepalive = false): Promise<void> => {
  const currentPage = pendingPage.value;

  if (currentPage === null) {
    return;
  }

  pendingPage.value = null;
  await persistProgress(currentPage, keepalive);
};

/**
 * Schedules current-page persistence for reader navigation.
 */
const handlePageChange = (currentPage: number): void => {
  progressError.value = "";
  pendingPage.value = currentPage;
  void saveProgress();
};

onBeforeRouteLeave(async () => {
  await flushProgress();
});

useEventListener(
  () => (import.meta.client ? document : null),
  "visibilitychange",
  () => {
    if (document.visibilityState === "hidden") {
      void flushProgress(true);
    }
  }
);

useEventListener(
  () => (import.meta.client ? window : null),
  "pagehide",
  () => {
    void flushProgress(true);
  }
);

onBeforeUnmount(() => {
  void flushProgress(true);
});
</script>

<template>
  <ClientOnly>
    <div v-if="pending" class="status" role="status">
      <ProgressSpinner class="spinner" stroke-width="4" />
      <span>書籍を読み込んでいます。</span>
    </div>
    <Message
      v-else-if="error"
      class="status"
      severity="error"
      :closable="false"
    >
      <span>{{ errorMessage }}</span>
      <span class="status-actions">
        <NuxtLink v-if="actionLink" :to="actionLink.to">
          {{ actionLink.label }}
        </NuxtLink>
        <Button
          v-else
          label="再試行"
          icon="pi pi-refresh"
          severity="secondary"
          size="small"
          @click="() => refresh()"
        />
        <NuxtLink to="/">ライブラリへ戻る</NuxtLink>
      </span>
    </Message>
    <template v-else-if="data">
      <ReaderView :book="data" @page-change="handlePageChange" />
      <Message
        v-if="progressError"
        class="progress-status is-error"
        severity="error"
        :closable="false"
      >
        {{ progressError }}
      </Message>
    </template>
    <template #fallback>
      <div class="status" role="status">
        <ProgressSpinner class="spinner" stroke-width="4" />
        <span>書籍を読み込んでいます。</span>
      </div>
    </template>
  </ClientOnly>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: min(720px, calc(100% - 2rem));
  padding: 1rem;
  margin: 1rem auto;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}

.status a {
  color: var(--text);
}

.status-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.75rem;
}

.is-error {
  color: var(--danger);
}

.progress-status {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 30;
  width: min(24rem, calc(100% - 2rem));
  padding: 0.85rem 1rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 18%);
}

.spinner {
  inline-size: 2rem;
  block-size: 2rem;
}
</style>
