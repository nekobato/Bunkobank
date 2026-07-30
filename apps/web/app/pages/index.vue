<script setup lang="ts">
/**
 * Searchable book list for the selected library.
 *
 * @module
 */

import type { BookSummary } from "@bookcafe/core";
import { useIntervalFn } from "@vueuse/core";

import { getAccessErrorMessage, getApiErrorMessage } from "../utils/apiErrors";
import {
  areLibraryFiltersEqual,
  bookStatusFilterOptions,
  BOOK_LIST_PAGE_SIZE,
  createLibraryQuery,
  formatLibraryResultSummary,
  getRouteBookStatus,
  getRoutePage,
  getRouteReadingStatus,
  getRouteSearch,
  readingStatusFilterOptions,
  type BookStatusFilter,
  type ReadingStatusFilter
} from "../utils/libraryFilters";

const route = useRoute();
const { archiveBook, createScanJob, getJob, listBooks } = useBookApi();
const {
  error: libraryError,
  loaded: librariesLoaded,
  loading: librariesLoading,
  refreshLibraries,
  selectedLibrary,
  selectedLibraryId
} = useLibraries();
const searchText = ref(getRouteSearch(route.query.q));
const readingStatus = ref<ReadingStatusFilter>(
  getRouteReadingStatus(route.query.readingStatus)
);
const bookStatus = ref<BookStatusFilter>(
  getRouteBookStatus(route.query.bookStatus)
);
const bookToArchive = ref<BookSummary | null>(null);
const isArchiving = ref(false);
const isScanning = ref(false);
const activeScanJobId = ref<string | null>(null);
const operationMessage = ref("");
const operationSeverity = ref<"success" | "error">("success");
const appliedSearch = computed(() => getRouteSearch(route.query.q));
const appliedReadingStatus = computed(() =>
  getRouteReadingStatus(route.query.readingStatus)
);
const appliedBookStatus = computed(() =>
  getRouteBookStatus(route.query.bookStatus)
);
const appliedPage = computed(() => getRoutePage(route.query.page));
const { data, error, pending, refresh } = await useAsyncData(
  "selected-library-books",
  () =>
    selectedLibraryId.value
      ? listBooks(selectedLibraryId.value, {
          q: appliedSearch.value || undefined,
          readingStatus: appliedReadingStatus.value || undefined,
          bookStatus: appliedBookStatus.value || undefined,
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
    watch: [
      selectedLibraryId,
      appliedSearch,
      appliedReadingStatus,
      appliedBookStatus,
      appliedPage
    ]
  }
);
const books = computed(() => data.value?.books ?? []);
const totalBooks = computed(() => data.value?.total ?? 0);
const firstBookOffset = computed(
  () => (appliedPage.value - 1) * BOOK_LIST_PAGE_SIZE
);
const statusCode = computed(() => error.value?.statusCode);
const hasActiveFilters = computed(() =>
  Boolean(
    searchText.value ||
    readingStatus.value ||
    bookStatus.value ||
    appliedSearch.value ||
    appliedReadingStatus.value ||
    appliedBookStatus.value
  )
);
const hasAppliedFilters = computed(() =>
  Boolean(
    appliedSearch.value || appliedReadingStatus.value || appliedBookStatus.value
  )
);
const resultSummary = computed(() =>
  formatLibraryResultSummary(
    totalBooks.value,
    appliedSearch.value,
    appliedReadingStatus.value,
    appliedBookStatus.value
  )
);
const libraryErrorMessage = computed(() =>
  getApiErrorMessage(libraryError.value, "ライブラリを読み込めませんでした。")
);
const emptyMessage = computed(() =>
  hasAppliedFilters.value
    ? "条件に一致する本はありません。"
    : "本は登録されていません。"
);
const errorMessage = computed(() =>
  getAccessErrorMessage(statusCode.value, "蔵書を読み込めませんでした。")
);

const { pause: pauseScanPolling, resume: resumeScanPolling } = useIntervalFn(
  refreshActiveScan,
  1500,
  { immediate: false }
);

watch(selectedLibraryId, () => {
  activeScanJobId.value = null;
  isScanning.value = false;
  pauseScanPolling();
});

watch(
  [appliedSearch, appliedReadingStatus, appliedBookStatus],
  ([nextSearch, nextReadingStatus, nextBookStatus]) => {
    searchText.value = nextSearch;
    readingStatus.value = nextReadingStatus;
    bookStatus.value = nextBookStatus;
  }
);

/** Applies the current filters to the route query. */
const submitFilters = async (): Promise<void> => {
  if (
    areLibraryFiltersEqual(
      searchText.value,
      readingStatus.value,
      bookStatus.value,
      appliedSearch.value,
      appliedReadingStatus.value,
      appliedBookStatus.value
    )
  ) {
    await refresh();
    return;
  }

  await navigateTo(
    {
      path: "/",
      query: createLibraryQuery(
        searchText.value,
        readingStatus.value,
        bookStatus.value
      )
    },
    { replace: true }
  );
};

/** Clears every book-list filter. */
const clearFilters = async (): Promise<void> => {
  searchText.value = "";
  readingStatus.value = "";
  bookStatus.value = "";

  if (!hasAppliedFilters.value) {
    await refresh();
    return;
  }

  await navigateTo({ path: "/", query: {} }, { replace: true });
};

/** Starts a scan for the selected library. */
const scanSelectedLibrary = async (): Promise<void> => {
  if (!selectedLibraryId.value) {
    return;
  }

  isScanning.value = true;
  operationMessage.value = "";

  try {
    const job = await createScanJob(selectedLibraryId.value);
    activeScanJobId.value = job.id;
    resumeScanPolling();
    operationSeverity.value = "success";
    operationMessage.value = "スキャンを開始しました。";
    await refreshActiveScan();
  } catch (error) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      error,
      "スキャンを開始できませんでした。"
    );
    isScanning.value = false;
  }
};

/**
 * Polls the active scan and refreshes books when it reaches a terminal state.
 */
async function refreshActiveScan(): Promise<void> {
  const libraryId = selectedLibraryId.value;
  const jobId = activeScanJobId.value;

  if (!libraryId || !jobId) {
    pauseScanPolling();
    return;
  }

  try {
    const job = await getJob(libraryId, jobId);

    if (job.status === "queued" || job.status === "running") {
      return;
    }

    activeScanJobId.value = null;
    isScanning.value = false;
    pauseScanPolling();
    await refresh();
    operationSeverity.value = job.status === "completed" ? "success" : "error";
    operationMessage.value =
      job.status === "completed"
        ? "スキャンが完了し、蔵書を更新しました。"
        : (job.error ?? "スキャンは完了しませんでした。");
  } catch (error) {
    activeScanJobId.value = null;
    isScanning.value = false;
    pauseScanPolling();
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      error,
      "スキャン状況を確認できませんでした。"
    );
  }
}

/**
 * Moves to a one-based page while retaining the active filters.
 */
const changePage = async (event: { page: number }): Promise<void> => {
  await navigateTo(
    {
      path: "/",
      query: createLibraryQuery(
        appliedSearch.value,
        appliedReadingStatus.value,
        appliedBookStatus.value,
        event.page + 1
      )
    },
    { replace: true }
  );
};

/** Archives the confirmed book and refreshes the visible list. */
const confirmArchive = async (): Promise<void> => {
  if (!bookToArchive.value || !selectedLibraryId.value) {
    return;
  }

  isArchiving.value = true;
  operationMessage.value = "";

  try {
    await archiveBook(selectedLibraryId.value, bookToArchive.value.id);
    bookToArchive.value = null;
    await refresh();
    operationSeverity.value = "success";
    operationMessage.value = "アーカイブしました。";
  } catch (error) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      error,
      "アーカイブできませんでした。"
    );
  } finally {
    isArchiving.value = false;
  }
};
</script>

<template>
  <section class="library">
    <header class="heading">
      <div>
        <p v-if="selectedLibrary" class="page-eyebrow">
          {{ selectedLibrary.name }}
        </p>
        <h1 class="page-title">蔵書</h1>
      </div>
      <div class="commands" aria-label="ライブラリ操作">
        <Button
          label="更新"
          icon="pi pi-refresh"
          severity="secondary"
          variant="outlined"
          :disabled="!selectedLibraryId"
          @click="() => refresh()"
        />
        <Button
          label="スキャン"
          icon="pi pi-sync"
          :loading="isScanning"
          :disabled="!selectedLibraryId"
          @click="scanSelectedLibrary"
        />
      </div>
    </header>

    <Card v-if="selectedLibraryId" class="filter-card">
      <template #content>
        <form class="search" @submit.prevent="submitFilters">
          <div class="search-field">
            <label for="library-search">検索</label>
            <IconField>
              <InputIcon class="pi pi-search" />
              <InputText
                id="library-search"
                v-model="searchText"
                name="q"
                type="search"
                autocomplete="off"
                maxlength="200"
                enterkeyhint="search"
                placeholder="タイトル、著者、タグ"
                fluid
              />
            </IconField>
          </div>
          <div class="select-field">
            <span id="reading-filter-label" class="control-label">
              読書状況
            </span>
            <Select
              v-model="readingStatus"
              input-id="reading-filter"
              :options="readingStatusFilterOptions"
              option-label="label"
              option-value="value"
              aria-labelledby="reading-filter-label"
              fluid
            />
          </div>
          <div class="select-field">
            <span id="source-filter-label" class="control-label">
              元ファイル
            </span>
            <Select
              v-model="bookStatus"
              input-id="source-filter"
              :options="bookStatusFilterOptions"
              option-label="label"
              option-value="value"
              aria-labelledby="source-filter-label"
              fluid
            />
          </div>
          <div class="filter-actions">
            <Button label="絞り込む" icon="pi pi-filter" type="submit" />
            <Button
              v-if="hasActiveFilters"
              label="クリア"
              icon="pi pi-times"
              severity="secondary"
              variant="text"
              type="button"
              @click="clearFilters"
            />
          </div>
        </form>
      </template>
    </Card>

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
      <Message v-else-if="libraryError" severity="error" :closable="false">
        <span>{{ libraryErrorMessage }}</span>
        <Button
          label="再試行"
          icon="pi pi-refresh"
          size="small"
          @click="refreshLibraries"
        />
      </Message>
      <Card v-else-if="!selectedLibraryId" class="empty-card">
        <template #content>
          <i class="pi pi-folder-open" aria-hidden="true" />
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
      <template v-else>
        <p class="summary" aria-live="polite">{{ resultSummary }}</p>
        <BookList
          v-if="books.length > 0"
          :books="books"
          @archive="bookToArchive = $event"
        />
        <Paginator
          v-if="totalBooks > BOOK_LIST_PAGE_SIZE"
          :first="firstBookOffset"
          :rows="BOOK_LIST_PAGE_SIZE"
          :total-records="totalBooks"
          template="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
          current-page-report-template="{currentPage} / {totalPages}"
          aria-label="蔵書ページ"
          @page="changePage"
        />
        <Card v-else class="empty-card">
          <template #content>
            <i class="pi pi-book" aria-hidden="true" />
            <p>{{ emptyMessage }}</p>
            <Button
              v-if="hasActiveFilters"
              label="絞り込みを解除"
              severity="secondary"
              variant="outlined"
              @click="clearFilters"
            />
          </template>
        </Card>
      </template>
    </ClientOnly>

    <Dialog
      :visible="bookToArchive !== null"
      modal
      header="アーカイブ"
      :style="{ width: 'min(28rem, calc(100vw - 2rem))' }"
      @update:visible="bookToArchive = null"
    >
      <p class="dialog-copy">
        「{{ bookToArchive?.title }}」を非表示にします。
      </p>
      <template #footer>
        <Button
          label="キャンセル"
          severity="secondary"
          variant="text"
          @click="bookToArchive = null"
        />
        <Button
          label="アーカイブ"
          icon="pi pi-inbox"
          :loading="isArchiving"
          @click="confirmArchive"
        />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.library {
  display: grid;
  gap: 1.4rem;
  inline-size: min(82rem, 100%);
  padding: clamp(1.25rem, 4vw, 3.5rem);
  margin: 0 auto;
}

.heading,
.commands,
.filter-actions {
  display: flex;
}

.heading {
  align-items: end;
  justify-content: space-between;
  gap: 1.5rem;
}

.heading h1,
.page-eyebrow {
  margin: 0;
}

.commands,
.filter-actions {
  flex-wrap: wrap;
  gap: 0.5rem;
}

.filter-card {
  border-inline-start: 0.35rem solid var(--bc-ink-blue);
}

.filter-card :deep(.p-card-body) {
  padding: 1rem;
}

.filter-card :deep(.p-card-content) {
  padding: 0;
}

.search {
  display: grid;
  grid-template-columns:
    minmax(14rem, 1.5fr) minmax(9rem, 0.6fr) minmax(9rem, 0.6fr)
    auto;
  align-items: end;
  gap: 0.8rem;
}

.search-field,
.select-field {
  display: grid;
  gap: 0.38rem;
  min-inline-size: 0;
}

.search label,
.search .control-label {
  color: var(--bc-ink-soft);
  font-size: 0.76rem;
  font-weight: 700;
}

.summary {
  margin: 0;
  color: var(--bc-ink-soft);
  font-family: var(--bc-font-data);
  font-size: 0.78rem;
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

.empty-card i {
  color: var(--bc-patina);
  font-size: 2rem;
}

.empty-card p,
.dialog-copy {
  margin: 0;
  color: var(--bc-ink-soft);
}

@media (width <= 68rem) {
  .search {
    grid-template-columns: minmax(0, 1fr) minmax(9rem, 0.6fr) minmax(
        9rem,
        0.6fr
      );
  }

  .filter-actions {
    grid-column: 1 / -1;
  }
}

@media (width <= 44rem) {
  .heading {
    align-items: start;
    flex-direction: column;
  }

  .search {
    grid-template-columns: minmax(0, 1fr);
  }

  .filter-actions {
    grid-column: auto;
  }
}
</style>
