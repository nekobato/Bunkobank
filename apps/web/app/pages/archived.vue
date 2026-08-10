<script setup lang="ts">
/**
 * Archived books for the selected library.
 *
 * @module
 */

import type { BookSummary } from "@bunkobank/core";

import { getAccessErrorMessage, getApiErrorMessage } from "../utils/apiErrors";
import { BOOK_LIST_PAGE_SIZE, getRoutePage } from "../utils/libraryFilters";

useHead({ title: "アーカイブ" });

const route = useRoute();
const { listArchivedBooks, restoreBook } = useBookApi();
const {
  error: libraryError,
  loaded: librariesLoaded,
  loading: librariesLoading,
  refreshLibraries,
  selectedLibrary,
  selectedLibraryId
} = useLibraries();
const restoringBookId = ref<string | null>(null);
const operationMessage = ref("");
const operationSeverity = ref<"success" | "error">("success");
const appliedPage = computed(() => getRoutePage(route.query.page));
const { data, error, pending, refresh } = await useAsyncData(
  "selected-library-archived-books",
  () =>
    selectedLibraryId.value
      ? listArchivedBooks(selectedLibraryId.value, {
          offset: (appliedPage.value - 1) * BOOK_LIST_PAGE_SIZE,
          limit: BOOK_LIST_PAGE_SIZE
        })
      : Promise.resolve({
          books: [],
          total: 0,
          offset: 0,
          limit: BOOK_LIST_PAGE_SIZE,
          hasMore: false
        }),
  {
    default: () => ({
      books: [],
      total: 0,
      offset: 0,
      limit: BOOK_LIST_PAGE_SIZE,
      hasMore: false
    }),
    server: false,
    watch: [selectedLibraryId, appliedPage]
  }
);
const books = computed(() => data.value?.books ?? []);
const totalBooks = computed(() => data.value?.total ?? 0);
const libraryErrorMessage = computed(() =>
  getApiErrorMessage(libraryError.value, "ライブラリを読み込めませんでした。")
);
const errorMessage = computed(() =>
  getAccessErrorMessage(
    error.value?.statusCode,
    "アーカイブを読み込めませんでした。"
  )
);

/**
 * Moves to a one-based archived-book page.
 */
const changePage = async (page: number): Promise<void> => {
  await navigateTo(
    {
      path: "/archived",
      query: page > 1 ? { page: String(page) } : {}
    },
    { replace: true }
  );
};

/** Restores one archived book without starting a scan. */
const restoreArchivedBook = async (book: BookSummary): Promise<void> => {
  if (!selectedLibraryId.value) {
    return;
  }

  restoringBookId.value = book.id;
  operationMessage.value = "";

  try {
    await restoreBook(selectedLibraryId.value, book.id);
    await refresh();
    operationSeverity.value = "success";
    operationMessage.value = "元に戻しました。";
  } catch (error) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      error,
      "元に戻せませんでした。"
    );
  } finally {
    restoringBookId.value = null;
  }
};
</script>

<template>
  <section class="archive">
    <header class="heading">
      <div>
        <p v-if="selectedLibrary" class="page-eyebrow">
          {{ selectedLibrary.name }}
        </p>
        <h1 class="page-title">アーカイブ</h1>
      </div>
      <ElButton
        :icon="ElIconRefresh"
        type="info"
        plain
        :disabled="!selectedLibraryId"
        @click="() => refresh()"
      >
        更新
      </ElButton>
    </header>

    <ElAlert
      v-if="operationMessage"
      :type="operationSeverity"
      :closable="false"
      show-icon
    >
      {{ operationMessage }}
    </ElAlert>

    <ClientOnly>
      <div
        v-if="librariesLoading || (!librariesLoaded && pending)"
        class="status"
        role="status"
      >
        <LoadingIndicator class="spinner" />
      </div>
      <ElAlert
        v-else-if="libraryError"
        type="error"
        :closable="false"
        show-icon
      >
        <span>{{ libraryErrorMessage }}</span>
        <ElButton :icon="ElIconRefresh" size="small" @click="refreshLibraries">
          再試行
        </ElButton>
      </ElAlert>
      <ElCard v-else-if="!selectedLibraryId" class="empty-card">
        <template #default>
          <p>ライブラリは未登録です。</p>
          <NuxtLink class="button-link" to="/setup">
            <ElButton :icon="ElIconSetting">設定を開く</ElButton>
          </NuxtLink>
        </template>
      </ElCard>
      <div v-else-if="pending" class="status" role="status">
        <LoadingIndicator class="spinner" />
      </div>
      <ElAlert v-else-if="error" type="error" :closable="false" show-icon>
        {{ errorMessage }}
      </ElAlert>
      <template v-else-if="books.length > 0">
        <BookList
          :books="books"
          mode="archived"
          :busy-book-id="restoringBookId"
          :aria-busy="restoringBookId !== null"
          @restore="restoreArchivedBook"
        />
        <ElPagination
          v-if="totalBooks > BOOK_LIST_PAGE_SIZE"
          :current-page="appliedPage"
          :page-size="BOOK_LIST_PAGE_SIZE"
          :total="totalBooks"
          layout="prev, pager, next"
          background
          aria-label="アーカイブページ"
          @current-change="changePage"
        />
      </template>
      <ElCard v-else class="empty-card">
        <template #default>
          <p>アーカイブは空です。</p>
        </template>
      </ElCard>
    </ClientOnly>
  </section>
</template>

<style scoped>
.archive {
  display: grid;
  gap: 1.4rem;
  inline-size: min(82rem, 100%);
  padding: clamp(1.25rem, 4vw, 3.5rem);
  margin: 0 auto;
}

.button-link {
  text-decoration: none;
}

.heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
}

.heading h1,
.page-eyebrow {
  margin: 0;
}

.status {
  display: grid;
  min-block-size: 8rem;
  place-items: center;
}

.spinner {
  inline-size: 2rem;
  block-size: 2rem;
}

.empty-card {
  text-align: center;
}

.empty-card :deep(.el-card__body) {
  display: grid;
  justify-items: center;
  gap: 0.85rem;
  padding-block: 2.5rem;
}

.empty-card p {
  margin: 0;
  color: var(--bc-ink-soft);
}
</style>
