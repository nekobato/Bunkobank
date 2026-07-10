<script setup lang="ts">
import { getApiErrorMessage } from "../utils/apiErrors";
import {
  areLibraryFiltersEqual,
  bookStatusFilterOptions,
  createLibraryQuery,
  formatLibraryResultSummary,
  getRouteBookStatus,
  getRouteReadingStatus,
  getRouteSearch,
  readingStatusFilterOptions,
  type BookStatusFilter,
  type ReadingStatusFilter
} from "../utils/libraryFilters";

const route = useRoute();
const { exportLibrary, listBooks } = useBookApi();
const searchText = ref(getRouteSearch(route.query.q));
const readingStatus = ref<ReadingStatusFilter>(
  getRouteReadingStatus(route.query.readingStatus)
);
const bookStatus = ref<BookStatusFilter>(
  getRouteBookStatus(route.query.bookStatus)
);
const exportMessage = ref("");
const isExporting = ref(false);
const appliedSearch = computed(() => getRouteSearch(route.query.q));
const appliedReadingStatus = computed(() =>
  getRouteReadingStatus(route.query.readingStatus)
);
const appliedBookStatus = computed(() =>
  getRouteBookStatus(route.query.bookStatus)
);
const { data, error, pending, refresh } = await useAsyncData(
  "books",
  () =>
    listBooks({
      q: appliedSearch.value || undefined,
      readingStatus: appliedReadingStatus.value || undefined,
      bookStatus: appliedBookStatus.value || undefined
    }),
  {
    server: false,
    watch: [appliedSearch, appliedReadingStatus, appliedBookStatus]
  }
);
const books = computed(() => data.value?.books ?? []);
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
    books.value.length,
    appliedSearch.value,
    appliedReadingStatus.value,
    appliedBookStatus.value
  )
);
const emptyMessage = computed(() =>
  hasAppliedFilters.value
    ? "No books match the current filters"
    : "No books found"
);
const actionLink = computed(() => {
  if (statusCode.value === 409) {
    return { label: "Setup", to: "/setup" };
  }

  if (statusCode.value === 401) {
    return { label: "Login", to: "/login" };
  }

  return null;
});
const errorMessage = computed(() =>
  statusCode.value === 409 || statusCode.value === 401
    ? "Authentication required."
    : "Failed to load books."
);

watch(
  [appliedSearch, appliedReadingStatus, appliedBookStatus],
  ([nextSearch, nextReadingStatus, nextBookStatus]) => {
    searchText.value = nextSearch;
    readingStatus.value = nextReadingStatus;
    bookStatus.value = nextBookStatus;
  }
);

/**
 * Applies the current filters to the route query.
 */
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

/**
 * Clears the filters and refreshes the library.
 */
const clearFilters = async (): Promise<void> => {
  searchText.value = "";
  readingStatus.value = "";
  bookStatus.value = "";

  if (
    !appliedSearch.value &&
    !appliedReadingStatus.value &&
    !appliedBookStatus.value
  ) {
    await refresh();
    return;
  }

  await navigateTo({ path: "/", query: {} }, { replace: true });
};

/**
 * Downloads the current library metadata as a versioned JSON file.
 */
const downloadLibraryExport = async (): Promise<void> => {
  if (isExporting.value) {
    return;
  }

  isExporting.value = true;
  exportMessage.value = "";

  try {
    const exportData = await exportLibrary();
    triggerJsonDownload(
      createLibraryExportFileName(exportData.exportedAt),
      exportData
    );
    exportMessage.value = `Exported ${exportData.books.length} books`;
  } catch (error) {
    exportMessage.value = getApiErrorMessage(error, "Export failed");
  } finally {
    isExporting.value = false;
  }
};

/**
 * Builds the client-side filename matching the server export convention.
 */
const createLibraryExportFileName = (exportedAt: string): string =>
  `bookcafe-library-${exportedAt
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z")}.json`;

/**
 * Creates a temporary object URL and clicks a synthetic download link.
 */
const triggerJsonDownload = (fileName: string, payload: unknown): void => {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;

  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};
</script>

<template>
  <section class="library">
    <div class="heading">
      <h1>Library</h1>
      <div class="tools">
        <form
          class="search"
          action="/"
          method="get"
          @submit.prevent="submitFilters"
        >
          <label class="field" for="library-search">
            <span>Search</span>
            <input
              id="library-search"
              v-model="searchText"
              name="q"
              type="search"
              autocomplete="off"
              maxlength="200"
              enterkeyhint="search"
            />
          </label>
          <fieldset class="filter">
            <legend>Reading status</legend>
            <div class="choices">
              <label
                v-for="option in readingStatusFilterOptions"
                :key="option.value || 'all'"
                class="choice"
              >
                <input
                  v-model="readingStatus"
                  type="radio"
                  name="readingStatus"
                  :value="option.value"
                  @change="submitFilters"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>
          </fieldset>
          <fieldset class="filter">
            <legend>Book status</legend>
            <div class="choices">
              <label
                v-for="option in bookStatusFilterOptions"
                :key="option.value || 'all'"
                class="choice"
              >
                <input
                  v-model="bookStatus"
                  type="radio"
                  name="bookStatus"
                  :value="option.value"
                  @change="submitFilters"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>
          </fieldset>
          <div class="actions">
            <button type="submit">Search</button>
            <button v-if="hasActiveFilters" type="button" @click="clearFilters">
              Clear
            </button>
          </div>
        </form>
        <div class="commands">
          <button type="button" @click="() => refresh()">Refresh</button>
          <button
            type="button"
            :disabled="isExporting || Boolean(error)"
            @click="downloadLibraryExport"
          >
            {{ isExporting ? "Exporting" : "Export JSON" }}
          </button>
        </div>
      </div>
    </div>
    <LibraryManager v-if="!error" @updated="() => refresh()" />
    <p v-if="exportMessage" class="message" aria-live="polite">
      {{ exportMessage }}
    </p>
    <p v-if="!pending && !error" class="summary" aria-live="polite">
      {{ resultSummary }}
    </p>
    <p v-if="pending" class="status">Loading</p>
    <p v-else-if="error" class="status is-error">
      <span>{{ errorMessage }}</span>
      <NuxtLink v-if="actionLink" :to="actionLink.to">
        {{ actionLink.label }}
      </NuxtLink>
    </p>
    <BookList v-else-if="books.length > 0" :books="books" />
    <p v-else class="status">{{ emptyMessage }}</p>
  </section>
</template>

<style scoped>
.library {
  display: grid;
  gap: 1.25rem;
  width: min(1100px, 100%);
  padding: clamp(1rem, 4vw, 2rem);
  margin: 0 auto;
}

.heading {
  display: grid;
  gap: 1rem;
}

.heading h1 {
  margin: 0;
  font-size: clamp(1.6rem, 5vw, 2.4rem);
}

.tools {
  display: flex;
  align-items: end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.search {
  display: flex;
  align-items: end;
  flex: 1 1 30rem;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: min(100%, 18rem);
}

.field {
  display: grid;
  flex: 1 1 16rem;
  gap: 0.35rem;
  min-width: min(100%, 16rem);
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
  font: inherit;
}

.filter {
  display: grid;
  gap: 0.35rem;
  min-width: min(100%, 19rem);
  padding: 0;
  border: 0;
  margin: 0;
}

.filter legend {
  padding: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.choice {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2.5rem;
  padding: 0 0.65rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel);
  cursor: pointer;
}

.choice input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.commands {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tools button {
  min-height: 2.5rem;
  padding: 0 0.85rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel);
  cursor: pointer;
}

.tools button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.message {
  margin: 0;
  color: var(--muted);
  font-size: 0.95rem;
}

.summary {
  margin: 0;
  color: var(--muted);
  font-size: 0.95rem;
}

.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}

.status a {
  color: var(--text);
}

.is-error {
  color: var(--danger);
}
</style>
