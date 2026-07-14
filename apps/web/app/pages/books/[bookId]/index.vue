<script setup lang="ts">
import { getApiErrorMessage } from "../../../utils/apiErrors";
import {
  getBookSourceStatusLabel,
  getBookSourceStatusMessage,
  getBookSourceStatusTitle,
  isReadableBookStatus
} from "../../../utils/bookAvailability";
import {
  createEmptyMetadataForm,
  toMetadataForm,
  toMetadataRequest,
  type MetadataForm
} from "../../../utils/metadataForm";

const route = useRoute("/books/[bookId]");
const bookId = computed(() => String(route.params.bookId));
const { getBook, updateBookMetadata } = useBookApi();
const { data, error, pending, refresh } = await useAsyncData(
  `book-metadata-${bookId.value}`,
  () => getBook(bookId.value),
  {
    server: false
  }
);
const form = ref<MetadataForm>(createEmptyMetadataForm());
const saving = ref(false);
const statusMessage = ref("");
const formError = ref("");
const sourceIssueId = "book-source-issue";
const statusCode = computed(() => error.value?.statusCode);
const canReadBook = computed(() =>
  data.value ? isReadableBookStatus(data.value.status) : false
);
const readRoute = computed(() =>
  data.value && canReadBook.value ? `/books/${data.value.id}/read` : undefined
);
const sourceStatusTitle = computed(() =>
  data.value ? getBookSourceStatusTitle(data.value.status) : ""
);
const sourceStatusMessage = computed(() =>
  data.value ? getBookSourceStatusMessage(data.value.status) : ""
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
    : getApiErrorMessage(error.value, "Failed to load book.")
);

watch(
  data,
  (book) => {
    if (book) {
      form.value = toMetadataForm(book);
    }
  },
  { immediate: true }
);

/**
 * Saves the current metadata form to the backend.
 */
const saveMetadata = async (): Promise<void> => {
  if (!data.value || saving.value) {
    return;
  }

  saving.value = true;
  statusMessage.value = "";
  formError.value = "";

  try {
    const book = await updateBookMetadata(
      bookId.value,
      toMetadataRequest(form.value)
    );
    data.value = book;
    form.value = toMetadataForm(book);
    statusMessage.value = "Saved";
  } catch (error) {
    formError.value = getApiErrorMessage(error, "Failed to save metadata.");
  } finally {
    saving.value = false;
  }
};

/**
 * Resets the form to the last loaded book detail.
 */
const resetMetadata = (): void => {
  if (!data.value) {
    return;
  }

  form.value = toMetadataForm(data.value);
  statusMessage.value = "";
  formError.value = "";
};

/**
 * Keeps unavailable reader navigation announced but inactive.
 */
const preventUnavailableRead = (event: Event): void => {
  if (canReadBook.value) {
    return;
  }

  event.preventDefault();
};
</script>

<template>
  <section class="detail">
    <p v-if="pending" class="status">Loading</p>
    <p v-else-if="error" class="status is-error">
      <span>{{ errorMessage }}</span>
      <NuxtLink v-if="actionLink" :to="actionLink.to">
        {{ actionLink.label }}
      </NuxtLink>
    </p>
    <template v-else-if="data">
      <header class="heading">
        <div>
          <p class="eyebrow">{{ data.format }}</p>
          <h1>{{ data.title }}</h1>
          <p class="source">{{ data.sourcePath }}</p>
        </div>
        <nav class="links" aria-label="Book actions">
          <NuxtLink to="/">Library</NuxtLink>
          <NuxtLink
            :to="readRoute"
            :class="{ 'is-disabled': !canReadBook }"
            :role="canReadBook ? undefined : 'link'"
            :tabindex="canReadBook ? undefined : 0"
            :aria-disabled="canReadBook ? undefined : 'true'"
            :aria-describedby="canReadBook ? undefined : sourceIssueId"
            @click="preventUnavailableRead"
          >
            Read
          </NuxtLink>
        </nav>
      </header>

      <p
        v-if="!canReadBook"
        :id="sourceIssueId"
        class="source-alert"
        role="status"
        aria-live="polite"
      >
        <span class="badge">{{ getBookSourceStatusLabel(data.status) }}</span>
        <strong>{{ sourceStatusTitle }}</strong>
        <span>{{ sourceStatusMessage }}</span>
      </p>

      <form
        class="form"
        method="post"
        :action="`/books/${data.id}`"
        @submit.prevent="saveMetadata"
      >
        <fieldset class="group">
          <legend>Metadata</legend>
          <label class="field" for="book-title">
            <span>Title</span>
            <input
              id="book-title"
              v-model="form.title"
              name="title"
              type="text"
              required
              maxlength="300"
              autocomplete="off"
            />
          </label>
          <label class="field" for="book-authors">
            <span>Authors</span>
            <textarea
              id="book-authors"
              v-model="form.authors"
              name="authors"
              rows="4"
              maxlength="10000"
              aria-describedby="authors-help"
            />
            <small id="authors-help">
              One author per line, or comma separated.
            </small>
          </label>
          <div class="split">
            <label class="field" for="book-publisher">
              <span>Publisher</span>
              <input
                id="book-publisher"
                v-model="form.publisher"
                name="publisher"
                type="text"
                maxlength="200"
                autocomplete="organization"
              />
            </label>
            <label class="field" for="book-isbn">
              <span>ISBN</span>
              <input
                id="book-isbn"
                v-model="form.isbn"
                name="isbn"
                type="text"
                maxlength="32"
                autocomplete="off"
                inputmode="numeric"
              />
            </label>
          </div>
          <label class="field" for="book-purchased-at">
            <span>Purchase date</span>
            <input
              id="book-purchased-at"
              v-model="form.purchasedAt"
              name="purchasedAt"
              type="date"
            />
          </label>
        </fieldset>

        <fieldset class="group">
          <legend>Reading</legend>
          <div class="choices" role="radiogroup" aria-label="Reading status">
            <label class="choice" for="reading-unread">
              <input
                id="reading-unread"
                v-model="form.readingStatus"
                name="readingStatus"
                type="radio"
                value="unread"
              />
              <span>Unread</span>
            </label>
            <label class="choice" for="reading-reading">
              <input
                id="reading-reading"
                v-model="form.readingStatus"
                name="readingStatus"
                type="radio"
                value="reading"
              />
              <span>Reading</span>
            </label>
            <label class="choice" for="reading-finished">
              <input
                id="reading-finished"
                v-model="form.readingStatus"
                name="readingStatus"
                type="radio"
                value="finished"
              />
              <span>Finished</span>
            </label>
          </div>
          <label class="field" for="book-tags">
            <span>Tags</span>
            <input
              id="book-tags"
              v-model="form.tags"
              name="tags"
              type="text"
              maxlength="3200"
              autocomplete="off"
              aria-describedby="tags-help"
            />
            <small id="tags-help">Comma separated.</small>
          </label>
          <label class="field" for="book-notes">
            <span>Notes</span>
            <textarea
              id="book-notes"
              v-model="form.notes"
              name="notes"
              rows="6"
              maxlength="10000"
            />
          </label>
        </fieldset>

        <p
          v-if="statusMessage || formError"
          class="notice"
          :class="{ 'is-error': formError }"
          aria-live="polite"
        >
          {{ formError || statusMessage }}
        </p>
        <div class="actions">
          <button type="submit" :disabled="saving">
            {{ saving ? "Saving" : "Save changes" }}
          </button>
          <button type="button" @click="resetMetadata">Reset</button>
          <button type="button" @click="() => refresh()">Refresh</button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 1.25rem;
  width: min(900px, 100%);
  padding: clamp(1rem, 4vw, 2rem);
  margin: 0 auto;
}

.heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}

.heading h1 {
  margin: 0.15rem 0 0;
  overflow-wrap: anywhere;
  font-size: clamp(1.5rem, 4vw, 2.2rem);
}

.eyebrow,
.source,
.field small {
  color: var(--muted);
}

.eyebrow {
  margin: 0;
  font-size: 0.85rem;
  text-transform: uppercase;
}

.source {
  margin: 0.4rem 0 0;
  overflow-wrap: anywhere;
  font-size: 0.9rem;
}

.links,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.links a,
.actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2.5rem;
  padding: 0 0.85rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.links a.is-disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.actions button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.source-alert {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.55rem;
  padding: 0.85rem 1rem;
  border: 1px solid color-mix(in oklab, var(--danger) 40%, var(--line));
  border-radius: 6px;
  color: var(--text);
  background: color-mix(in oklab, var(--danger) 8%, var(--panel));
}

.source-alert strong {
  color: var(--danger);
}

.badge {
  display: inline-flex;
  align-items: center;
  min-block-size: 1.35rem;
  padding: 0 0.45rem;
  border: 1px solid color-mix(in oklab, var(--danger) 40%, var(--line));
  border-radius: 4px;
  color: var(--danger);
  font-size: 0.78rem;
  line-height: 1.2;
  background: var(--panel);
}

.form {
  display: grid;
  gap: 1rem;
}

.group {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 6px;
}

.group legend {
  padding: 0 0.35rem;
  font-weight: 700;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field span {
  font-weight: 700;
}

.field input,
.field textarea {
  width: 100%;
  min-height: 2.75rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--panel);
  font: inherit;
}

.field textarea {
  min-height: 7rem;
  resize: vertical;
}

.field input:user-invalid,
.field textarea:user-invalid {
  border-color: var(--danger);
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  gap: 1rem;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.choice {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-block-size: 2.75rem;
  padding: 0 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}

.choice input {
  accent-color: var(--accent);
}

.notice,
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

.status {
  width: min(720px, calc(100% - 2rem));
  margin: 1rem auto;
}

.status a {
  color: var(--text);
}

.is-error {
  color: var(--danger);
}
</style>
