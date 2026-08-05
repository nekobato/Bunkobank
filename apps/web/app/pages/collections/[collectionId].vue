<script setup lang="ts">
/**
 * One manually ordered collection inside the selected library.
 *
 * @module
 */

import type { BookSummary } from "@bunkobank/core";

import { getApiErrorMessage } from "../../utils/apiErrors";
import { moveCollectionBook } from "../../utils/collectionOrder";
import { BOOK_LIST_PAGE_SIZE } from "../../utils/libraryFilters";

const route = useRoute();
const collectionId = computed(() => String(route.params.collectionId));
const {
  addCollectionBook,
  getCollection,
  listBooks,
  removeCollectionBook,
  reorderCollectionBooks
} = useBookApi();
const {
  error: libraryError,
  loaded: librariesLoaded,
  loading: librariesLoading,
  refreshLibraries,
  selectedLibrary,
  selectedLibraryId
} = useLibraries();
const operationMessage = ref("");
const operationSeverity = ref<"success" | "error">("success");
const busyBookId = ref<string | null>(null);
const pickerVisible = ref(false);
const pickerSearch = ref("");
const pickerPage = ref(1);
const pickerBooks = ref<BookSummary[]>([]);
const pickerTotal = ref(0);
const pickerLoading = ref(false);
const pickerError = ref("");
const { data, error, pending, refresh } = await useAsyncData(
  `collection-${collectionId.value}`,
  () =>
    selectedLibraryId.value
      ? getCollection(selectedLibraryId.value, collectionId.value)
      : Promise.resolve(null),
  {
    server: false,
    watch: [selectedLibraryId, collectionId]
  }
);
const books = computed(() => data.value?.books ?? []);
const collectionBookIds = computed(
  () => new Set(books.value.map(({ id }) => id))
);
const libraryErrorMessage = computed(() =>
  getApiErrorMessage(libraryError.value, "ライブラリを読み込めませんでした。")
);
const errorMessage = computed(() =>
  getApiErrorMessage(error.value, "コレクションを読み込めませんでした。")
);

useHead({
  title: () => data.value?.name ?? "コレクション"
});

watch(selectedLibraryId, () => {
  operationMessage.value = "";
  pickerVisible.value = false;
});

/**
 * Loads one database-bounded page of available book candidates.
 */
const loadPickerBooks = async (page = pickerPage.value): Promise<void> => {
  const libraryId = selectedLibraryId.value;

  if (!libraryId) {
    return;
  }

  pickerLoading.value = true;
  pickerError.value = "";
  pickerPage.value = page;

  try {
    const response = await listBooks(libraryId, {
      q: pickerSearch.value.trim() || undefined,
      bookStatus: "ready",
      sort: "title",
      order: "asc",
      offset: (page - 1) * BOOK_LIST_PAGE_SIZE,
      limit: BOOK_LIST_PAGE_SIZE
    });
    pickerBooks.value = response.books;
    pickerTotal.value = response.total;
  } catch (cause) {
    pickerError.value = getApiErrorMessage(
      cause,
      "追加できる本を読み込めませんでした。"
    );
  } finally {
    pickerLoading.value = false;
  }
};

/**
 * Opens the book picker and loads its first page.
 */
const openBookPicker = async (): Promise<void> => {
  pickerVisible.value = true;
  pickerSearch.value = "";
  await loadPickerBooks(1);
};

/**
 * Prevents duplicate additions and overlapping picker mutations.
 */
const isPickerBookDisabled = (book: BookSummary): boolean =>
  collectionBookIds.value.has(book.id) ||
  (busyBookId.value !== null && busyBookId.value !== book.id);

/**
 * Applies the picker search to the server query.
 */
const submitPickerSearch = async (): Promise<void> => {
  await loadPickerBooks(1);
};

/**
 * Moves to another candidate page.
 */
const changePickerPage = async (event: { page: number }): Promise<void> => {
  await loadPickerBooks(event.page + 1);
};

/**
 * Adds one available book at the end of this collection.
 */
const addBook = async (book: BookSummary): Promise<void> => {
  const libraryId = selectedLibraryId.value;

  if (!libraryId) {
    return;
  }

  busyBookId.value = book.id;
  operationMessage.value = "";

  try {
    data.value = await addCollectionBook(libraryId, collectionId.value, {
      bookId: book.id
    });
    operationSeverity.value = "success";
    operationMessage.value = "コレクションへ追加しました。";
  } catch (cause) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      cause,
      "コレクションへ追加できませんでした。"
    );
  } finally {
    busyBookId.value = null;
  }
};

/**
 * Persists one single-step manual order change.
 */
const moveBook = async (
  book: BookSummary,
  direction: -1 | 1
): Promise<void> => {
  const libraryId = selectedLibraryId.value;

  if (!libraryId) {
    return;
  }

  const nextOrder = moveCollectionBook(
    books.value.map(({ id }) => id),
    book.id,
    direction
  );
  busyBookId.value = book.id;
  operationMessage.value = "";

  try {
    data.value = await reorderCollectionBooks(libraryId, collectionId.value, {
      bookIds: nextOrder
    });
    operationSeverity.value = "success";
    operationMessage.value = "並び順を保存しました。";
  } catch (cause) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      cause,
      "並び順を保存できませんでした。"
    );
    await refresh();
  } finally {
    busyBookId.value = null;
  }
};

/**
 * Removes one membership without archiving or deleting the source book.
 */
const removeBook = async (book: BookSummary): Promise<void> => {
  const libraryId = selectedLibraryId.value;

  if (!libraryId) {
    return;
  }

  busyBookId.value = book.id;
  operationMessage.value = "";

  try {
    await removeCollectionBook(libraryId, collectionId.value, book.id);
    await refresh();
    operationSeverity.value = "success";
    operationMessage.value = "コレクションから外しました。";
  } catch (cause) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      cause,
      "コレクションから外せませんでした。"
    );
  } finally {
    busyBookId.value = null;
  }
};
</script>

<template>
  <section class="collection">
    <header class="heading">
      <div>
        <NuxtLink class="back-link" to="/collections">
          <i class="pi pi-arrow-left" aria-hidden="true" />
          コレクション一覧
        </NuxtLink>
        <p v-if="selectedLibrary" class="page-eyebrow">
          {{ selectedLibrary.name }}
        </p>
        <h1 class="page-title">{{ data?.name ?? "コレクション" }}</h1>
      </div>
      <div class="commands">
        <Button
          label="更新"
          icon="pi pi-refresh"
          severity="secondary"
          variant="outlined"
          :disabled="!selectedLibraryId"
          @click="() => refresh()"
        />
        <Button
          label="本を追加"
          icon="pi pi-plus"
          :disabled="!selectedLibraryId || Boolean(error)"
          @click="openBookPicker"
        />
      </div>
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
        mode="collection"
        :busy-book-id="busyBookId"
        @move-up="moveBook($event, -1)"
        @move-down="moveBook($event, 1)"
        @remove="removeBook"
      />
      <Card v-else class="empty-card">
        <template #content>
          <i class="pi pi-book" aria-hidden="true" />
          <p>このコレクションには本がありません。</p>
          <Button label="本を追加" icon="pi pi-plus" @click="openBookPicker" />
        </template>
      </Card>
    </ClientOnly>

    <Dialog
      v-model:visible="pickerVisible"
      modal
      header="本を追加"
      :style="{ width: 'min(48rem, calc(100vw - 2rem))' }"
    >
      <form class="picker-search" @submit.prevent="submitPickerSearch">
        <label for="collection-book-search">蔵書を検索</label>
        <div class="search-controls">
          <InputText
            id="collection-book-search"
            v-model="pickerSearch"
            type="search"
            maxlength="200"
            autocomplete="off"
            placeholder="タイトル、著者、タグ"
            fluid
          />
          <Button
            label="検索"
            icon="pi pi-search"
            type="submit"
            :loading="pickerLoading"
          />
        </div>
      </form>

      <div v-if="pickerLoading" class="status" role="status">
        <ProgressSpinner class="spinner" stroke-width="4" />
      </div>
      <Message v-else-if="pickerError" severity="error" :closable="false">
        {{ pickerError }}
      </Message>
      <ul v-else-if="pickerBooks.length > 0" class="picker-list">
        <li v-for="book in pickerBooks" :key="book.id">
          <span>
            <strong>{{ book.title }}</strong>
            <small v-if="book.authors.length > 0">
              {{ book.authors.join(", ") }}
            </small>
          </span>
          <Button
            :label="
              collectionBookIds.has(book.id) ? '追加済み' : 'コレクションへ追加'
            "
            :icon="
              collectionBookIds.has(book.id) ? 'pi pi-check' : 'pi pi-plus'
            "
            size="small"
            :loading="busyBookId === book.id"
            :disabled="isPickerBookDisabled(book)"
            @click="addBook(book)"
          />
        </li>
      </ul>
      <p v-else class="picker-empty">追加できる本はありません。</p>

      <Paginator
        v-if="pickerTotal > BOOK_LIST_PAGE_SIZE"
        :first="(pickerPage - 1) * BOOK_LIST_PAGE_SIZE"
        :rows="BOOK_LIST_PAGE_SIZE"
        :total-records="pickerTotal"
        template="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
        current-page-report-template="{currentPage} / {totalPages}"
        aria-label="追加する本のページ"
        @page="changePickerPage"
      />
    </Dialog>
  </section>
</template>

<style scoped>
.collection {
  display: grid;
  gap: 1.4rem;
  inline-size: min(82rem, 100%);
  padding: clamp(1.25rem, 4vw, 3.5rem);
  margin: 0 auto;
}

.heading,
.commands,
.search-controls {
  display: flex;
}

.heading {
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
}

.heading h1,
.page-eyebrow {
  margin: 0;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-block-end: 0.85rem;
  color: var(--bc-ink-blue);
  font-size: 0.84rem;
  text-decoration: none;
}

.back-link:hover {
  text-decoration: underline;
}

.commands {
  flex-wrap: wrap;
  gap: 0.5rem;
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

.empty-card p,
.picker-empty {
  margin: 0;
  color: var(--bc-ink-soft);
}

.picker-search {
  display: grid;
  gap: 0.38rem;
  margin-block-end: 1rem;
}

.picker-search label {
  color: var(--bc-ink-soft);
  font-size: 0.78rem;
  font-weight: 700;
}

.search-controls {
  align-items: center;
  gap: 0.5rem;
}

.picker-list {
  display: grid;
  max-block-size: min(55dvh, 34rem);
  overflow: auto;
  padding: 0;
  margin: 0;
  list-style: none;
}

.picker-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  border-block-end: 1px solid var(--bc-line-soft);
  padding-block: 0.75rem;
}

.picker-list span {
  display: grid;
  gap: 0.15rem;
  min-inline-size: 0;
}

.picker-list strong,
.picker-list small {
  overflow-wrap: anywhere;
}

.picker-list small {
  color: var(--bc-ink-soft);
}

@media (width <= 44rem) {
  .heading {
    align-items: start;
    flex-direction: column;
  }

  .search-controls {
    align-items: stretch;
    flex-direction: column;
  }

  .picker-list li {
    align-items: start;
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
