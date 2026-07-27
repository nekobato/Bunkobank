<script setup lang="ts">
/**
 * Archived books for the selected library.
 *
 * @module
 */

import type { BookSummary } from "@bookcafe/core";

import { getAccessErrorMessage, getApiErrorMessage } from "../utils/apiErrors";

const { listArchivedBooks, restoreBook } = useBookApi();
const {
  loaded: librariesLoaded,
  loading: librariesLoading,
  selectedLibrary,
  selectedLibraryId
} = useLibraries();
const restoringBookId = ref<string | null>(null);
const operationMessage = ref("");
const operationSeverity = ref<"success" | "error">("success");
const { data, error, pending, refresh } = await useAsyncData(
  "selected-library-archived-books",
  () =>
    selectedLibraryId.value
      ? listArchivedBooks(selectedLibraryId.value)
      : Promise.resolve({ books: [] }),
  {
    default: () => ({ books: [] }),
    server: false,
    watch: [selectedLibraryId]
  }
);
const books = computed(() => data.value?.books ?? []);
const errorMessage = computed(() =>
  getAccessErrorMessage(
    error.value?.statusCode,
    "アーカイブを読み込めませんでした。"
  )
);

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
      <Button
        label="更新"
        icon="pi pi-refresh"
        severity="secondary"
        variant="outlined"
        :disabled="!selectedLibraryId"
        @click="() => refresh()"
      />
    </header>

    <Message
      v-if="operationMessage"
      :severity="operationSeverity"
      :closable="false"
    >
      {{ operationMessage }}
    </Message>

    <ClientOnly>
      <div
        v-if="librariesLoading || (!librariesLoaded && pending)"
        class="status"
        role="status"
      >
        <ProgressSpinner class="spinner" stroke-width="4" />
      </div>
      <Card v-else-if="!selectedLibraryId" class="empty-card">
        <template #content>
          <p>ライブラリは未登録です。</p>
          <Button
            as="router-link"
            label="設定を開く"
            icon="pi pi-cog"
            to="/setup"
          />
        </template>
      </Card>
      <div v-else-if="pending" class="status" role="status">
        <ProgressSpinner class="spinner" stroke-width="4" />
      </div>
      <Message v-else-if="error" severity="error" :closable="false">
        {{ errorMessage }}
      </Message>
      <BookList
        v-else-if="books.length > 0"
        :books="books"
        mode="archived"
        :busy-book-id="restoringBookId"
        :aria-busy="restoringBookId !== null"
        @restore="restoreArchivedBook"
      />
      <Card v-else class="empty-card">
        <template #content>
          <p>アーカイブは空です。</p>
        </template>
      </Card>
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

.empty-card :deep(.p-card-content) {
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
