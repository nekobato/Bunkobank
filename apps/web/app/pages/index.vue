<script setup lang="ts">
/**
 * Searchable book list for the selected library.
 *
 * @module
 */

import type { BookSort, SortOrder } from "@bookcafe/contracts";
import type { BookSummary } from "@bookcafe/core";

import { getAccessErrorMessage, getApiErrorMessage } from "../utils/apiErrors";
import {
  areLibraryFiltersEqual,
  bookSortOptions,
  bookStatusFilterOptions,
  BOOK_LIST_PAGE_SIZE,
  createLibraryQuery,
  formatLibraryResultSummary,
  getRouteBookStatus,
  getRouteBookSort,
  getRoutePage,
  getRouteReadingStatus,
  getRouteSearch,
  getRouteSortOrder,
  readingStatusFilterOptions,
  sortOrderOptions,
  type BookStatusFilter,
  type ReadingStatusFilter
} from "../utils/libraryFilters";

useHead({ title: "蔵書" });

const route = useRoute();
const { listBooks } = useBookApi();
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
const sort = ref<BookSort>(getRouteBookSort(route.query.sort));
const order = ref<SortOrder>(getRouteSortOrder(route.query.order));
const isSearchDialogOpen = ref(false);
const isMetadataDialogOpen = ref(false);
const selectedBook = ref<BookSummary | null>(null);
const appliedSearch = computed(() => getRouteSearch(route.query.q));
const appliedReadingStatus = computed(() =>
  getRouteReadingStatus(route.query.readingStatus)
);
const appliedBookStatus = computed(() =>
  getRouteBookStatus(route.query.bookStatus)
);
const appliedSort = computed(() => getRouteBookSort(route.query.sort));
const appliedOrder = computed(() => getRouteSortOrder(route.query.order));
const appliedPage = computed(() => getRoutePage(route.query.page));
const { data, error, pending, refresh } = await useAsyncData(
  "selected-library-books",
  () =>
    selectedLibraryId.value
      ? listBooks(selectedLibraryId.value, {
          q: appliedSearch.value || undefined,
          readingStatus: appliedReadingStatus.value || undefined,
          bookStatus: appliedBookStatus.value || undefined,
          sort: appliedSort.value,
          order: appliedOrder.value,
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
      appliedSort,
      appliedOrder,
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

/** Restores the search form to the filters currently applied in the URL. */
const restoreAppliedFilters = (): void => {
  searchText.value = appliedSearch.value;
  readingStatus.value = appliedReadingStatus.value;
  bookStatus.value = appliedBookStatus.value;
  sort.value = appliedSort.value;
  order.value = appliedOrder.value;
};

/** Opens the search dialog with a fresh copy of the applied filters. */
const openSearchDialog = (): void => {
  restoreAppliedFilters();
  isSearchDialogOpen.value = true;
};

/** Opens the metadata editor for one visible book. */
const openMetadataDialog = (book: BookSummary): void => {
  selectedBook.value = book;
  isMetadataDialogOpen.value = true;
};

/** Refreshes the current result page after metadata changes. */
const handleMetadataUpdated = async (book: BookSummary): Promise<void> => {
  selectedBook.value = book;
  await refresh();
};

watch(selectedLibraryId, () => {
  isSearchDialogOpen.value = false;
  isMetadataDialogOpen.value = false;
  selectedBook.value = null;
});

watch(
  [
    appliedSearch,
    appliedReadingStatus,
    appliedBookStatus,
    appliedSort,
    appliedOrder
  ],
  () => restoreAppliedFilters()
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
      appliedBookStatus.value,
      sort.value,
      order.value,
      appliedSort.value,
      appliedOrder.value
    )
  ) {
    await refresh();
    isSearchDialogOpen.value = false;
    return;
  }

  await navigateTo(
    {
      path: "/",
      query: createLibraryQuery(
        searchText.value,
        readingStatus.value,
        bookStatus.value,
        1,
        sort.value,
        order.value
      )
    },
    { replace: true }
  );
  isSearchDialogOpen.value = false;
};

/** Clears every book-list filter. */
const clearFilters = async (): Promise<void> => {
  searchText.value = "";
  readingStatus.value = "";
  bookStatus.value = "";

  if (!hasAppliedFilters.value) {
    await refresh();
    isSearchDialogOpen.value = false;
    return;
  }

  await navigateTo(
    {
      path: "/",
      query: createLibraryQuery(
        "",
        "",
        "",
        1,
        appliedSort.value,
        appliedOrder.value
      )
    },
    { replace: true }
  );
  isSearchDialogOpen.value = false;
};

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
        event.page + 1,
        appliedSort.value,
        appliedOrder.value
      )
    },
    { replace: true }
  );
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
          label="検索"
          icon="pi pi-search"
          severity="secondary"
          variant="outlined"
          aria-haspopup="dialog"
          aria-controls="library-search-dialog"
          :aria-expanded="isSearchDialogOpen"
          :disabled="!selectedLibraryId"
          @click="openSearchDialog"
        />
      </div>
    </header>

    <Dialog
      id="library-search-dialog"
      v-model:visible="isSearchDialogOpen"
      header="蔵書を検索"
      modal
      block-scroll
      dismissable-mask
      :draggable="false"
      :style="{ width: 'min(36rem, calc(100vw - 2rem))' }"
      :breakpoints="{ '44rem': 'calc(100vw - 2rem)' }"
      :close-button-props="{ 'aria-label': '検索を閉じる' }"
    >
      <form
        id="library-search-form"
        class="search"
        @submit.prevent="submitFilters"
      >
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
              autofocus
              fluid
            />
          </IconField>
        </div>
        <div class="select-field">
          <span id="reading-filter-label" class="control-label">読書状況</span>
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
          <span id="source-filter-label" class="control-label">元ファイル</span>
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
        <div class="select-field">
          <span id="book-sort-label" class="control-label">並び順</span>
          <Select
            v-model="sort"
            input-id="book-sort"
            :options="bookSortOptions"
            option-label="label"
            option-value="value"
            aria-labelledby="book-sort-label"
            fluid
          />
        </div>
        <div class="select-field">
          <span id="book-order-label" class="control-label">方向</span>
          <Select
            v-model="order"
            input-id="book-order"
            :options="sortOrderOptions"
            option-label="label"
            option-value="value"
            aria-labelledby="book-order-label"
            fluid
          />
        </div>
        <div class="filter-actions">
          <Button label="検索" icon="pi pi-search" type="submit" />
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
    </Dialog>

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
          :editing-book-id="
            isMetadataDialogOpen ? (selectedBook?.id ?? null) : null
          "
          @edit="openMetadataDialog"
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

    <BookMetadataDialog
      v-model:visible="isMetadataDialogOpen"
      :book="selectedBook"
      :library-id="selectedLibraryId"
      @updated="handleMetadataUpdated"
    />
  </section>
</template>

<style scoped>
.library {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
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

.search {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: end;
  gap: 0.8rem;
  min-inline-size: 0;
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

.filter-actions {
  justify-content: flex-end;
  padding-block-start: 0.4rem;
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

@media (width <= 44rem) {
  .heading {
    align-items: start;
    flex-direction: column;
  }
}
</style>
