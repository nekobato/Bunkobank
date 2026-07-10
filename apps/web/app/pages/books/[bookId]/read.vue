<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";

import { getApiErrorMessage } from "../../../utils/apiErrors";

const route = useRoute("/books/[bookId]/read");
const bookId = computed(() => String(route.params.bookId));
const { getBook, updateBookProgress } = useBookApi();
const { data, error, pending } = await useAsyncData(
  `book-${bookId.value}`,
  () => getBook(bookId.value),
  {
    server: false
  }
);
const lastSavedPage = ref(1);
const progressError = ref("");
const statusCode = computed(() => error.value?.statusCode);
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
    : "Failed to load book."
);

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
const saveProgress = useDebounceFn(
  async (currentPage: number): Promise<void> => {
    if (!data.value || currentPage === lastSavedPage.value) {
      return;
    }

    try {
      const book = await updateBookProgress(bookId.value, { currentPage });
      data.value = book;
      lastSavedPage.value = book.currentPage;
      progressError.value = "";
    } catch (error) {
      progressError.value = getApiErrorMessage(
        error,
        "Progress could not be saved."
      );
    }
  },
  500,
  { maxWait: 2000 }
);

/**
 * Schedules current-page persistence for reader navigation.
 */
const handlePageChange = (currentPage: number): void => {
  progressError.value = "";
  void saveProgress(currentPage);
};
</script>

<template>
  <p v-if="pending" class="status">Loading</p>
  <p v-else-if="error" class="status is-error">
    <span>{{ errorMessage }}</span>
    <NuxtLink v-if="actionLink" :to="actionLink.to">
      {{ actionLink.label }}
    </NuxtLink>
  </p>
  <template v-else-if="data">
    <ReaderView :book="data" @page-change="handlePageChange" />
    <p
      v-if="progressError"
      class="progress-status is-error"
      role="status"
      aria-live="polite"
    >
      {{ progressError }}
    </p>
  </template>
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
</style>
