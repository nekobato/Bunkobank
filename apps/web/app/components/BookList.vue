<script setup lang="ts">
import type { BookSummary } from "@bunkobank/core";

import {
  getBookSourceStatusLabel,
  getBookSourceStatusMessage,
  isReadableBookStatus
} from "../utils/bookAvailability";
import { createBookCoverPlaceholder } from "../utils/bookCover";
import {
  getBookProgressPercent,
  getBookProgressValue
} from "../utils/bookProgress";

const {
  mode = "normal",
  busyBookId = null,
  editingBookId = null
} = defineProps<{
  books: BookSummary[];
  mode?: "normal" | "archived" | "collection";
  busyBookId?: string | null;
  editingBookId?: string | null;
}>();
const emit = defineEmits<{
  edit: [book: BookSummary];
  restore: [book: BookSummary];
  moveUp: [book: BookSummary];
  moveDown: [book: BookSummary];
  remove: [book: BookSummary];
}>();

/**
 * Formats authors for compact library cards.
 */
const getAuthorsLabel = (authors: string[]): string => authors.join(", ");

/**
 * Returns whether the book can currently open the reader.
 */
const canReadBook = (book: BookSummary): boolean =>
  isReadableBookStatus(book.status);

/**
 * Creates the reader route only when the source can be opened.
 */
const getReadRoute = (book: BookSummary): string | undefined =>
  mode !== "archived" && canReadBook(book)
    ? `/books/${book.id}/read`
    : undefined;

/**
 * Creates the thumbnail fallback view model for one library card.
 */
const getCoverPlaceholder = (book: BookSummary) =>
  createBookCoverPlaceholder({
    title: book.title,
    format: book.format,
    pageCount: book.pageCount
  });

/**
 * Creates the accessible name for the cover navigation link.
 */
const getCoverLinkLabel = (book: BookSummary): string =>
  book.thumbnailUrl
    ? `${book.title}を読む`
    : getCoverPlaceholder(book).accessibleName;

/** Returns a PrimeVue severity for source availability. */
const getSourceSeverity = (
  status: BookSummary["status"]
): "secondary" | "info" | "warn" | "danger" => {
  switch (status) {
    case "error":
      return "danger";
    case "missing":
      return "warn";
    case "scanning":
      return "info";
    default:
      return "secondary";
  }
};

/**
 * Creates a stable id for the source availability text on one card.
 */
const getAvailabilityId = (book: BookSummary): string =>
  `book-${book.id}-availability`;

/**
 * Creates the visible and assistive reading-progress label for one book.
 */
const getProgressLabel = (book: BookSummary): string =>
  `${book.title}の読書進捗: ${getBookProgressPercent(
    book.readingStatus,
    book.currentPage,
    book.pageCount
  )}%`;

/**
 * Creates the dialog id controlled by one book's edit button.
 */
const getMetadataDialogId = (book: BookSummary): string =>
  `book-${book.id}-metadata-dialog`;

/**
 * Stops reader navigation while keeping unavailable read links discoverable.
 */
const preventUnavailableRead = (event: Event, book: BookSummary): void => {
  if (mode !== "archived" && canReadBook(book)) {
    return;
  }

  event.preventDefault();
};
</script>

<template>
  <ul class="book-list" aria-label="蔵書">
    <li v-for="(book, index) in books" :key="book.id" class="item">
      <div class="book">
        <NuxtLink
          v-if="mode !== 'archived'"
          class="cover-link"
          :class="{ 'is-disabled': !canReadBook(book) }"
          :to="getReadRoute(book)"
          :role="canReadBook(book) ? undefined : 'link'"
          :tabindex="canReadBook(book) ? undefined : 0"
          :aria-label="getCoverLinkLabel(book)"
          :aria-disabled="canReadBook(book) ? undefined : 'true'"
          :aria-describedby="
            canReadBook(book) ? undefined : getAvailabilityId(book)
          "
          @click="preventUnavailableRead($event, book)"
        >
          <span class="cover">
            <img
              v-if="book.thumbnailUrl"
              :src="book.thumbnailUrl"
              alt=""
              width="160"
              height="240"
            />
            <span v-else class="empty" aria-hidden="true">
              <span class="mark">{{ getCoverPlaceholder(book).initials }}</span>
              <span class="details">
                <span>{{ getCoverPlaceholder(book).formatLabel }}</span>
                <span>{{ getCoverPlaceholder(book).pageLabel }}</span>
              </span>
            </span>
            <progress
              class="reading-progress"
              :max="book.pageCount"
              :value="
                getBookProgressValue(
                  book.readingStatus,
                  book.currentPage,
                  book.pageCount
                )
              "
              :aria-label="getProgressLabel(book)"
            />
          </span>
        </NuxtLink>
        <span v-else class="cover-link">
          <span class="cover">
            <img
              v-if="book.thumbnailUrl"
              :src="book.thumbnailUrl"
              alt=""
              width="160"
              height="240"
            />
            <span v-else class="empty" aria-hidden="true">
              <span class="mark">{{ getCoverPlaceholder(book).initials }}</span>
              <span class="details">
                <span>{{ getCoverPlaceholder(book).formatLabel }}</span>
                <span>{{ getCoverPlaceholder(book).pageLabel }}</span>
              </span>
            </span>
            <progress
              class="reading-progress"
              :max="book.pageCount"
              :value="
                getBookProgressValue(
                  book.readingStatus,
                  book.currentPage,
                  book.pageCount
                )
              "
              :aria-label="getProgressLabel(book)"
            />
          </span>
        </span>
        <div class="info">
          <NuxtLink
            v-if="mode !== 'archived'"
            class="title"
            :class="{ 'is-disabled': !canReadBook(book) }"
            :to="getReadRoute(book)"
            :role="canReadBook(book) ? undefined : 'link'"
            :tabindex="canReadBook(book) ? undefined : 0"
            :aria-disabled="canReadBook(book) ? undefined : 'true'"
            :aria-describedby="
              canReadBook(book) ? undefined : getAvailabilityId(book)
            "
            @click="preventUnavailableRead($event, book)"
          >
            {{ book.title }}
          </NuxtLink>
          <strong v-else class="title">{{ book.title }}</strong>
          <span v-if="book.authors.length > 0" class="authors">
            {{ getAuthorsLabel(book.authors) }}
          </span>
          <span class="line">
            <span class="meta">{{ book.pageCount }}ページ</span>
            <Tag
              v-if="book.status !== 'ready'"
              :value="getBookSourceStatusLabel(book.status)"
              :severity="getSourceSeverity(book.status)"
              rounded
            />
            <Button
              v-if="mode === 'normal'"
              class="edit-button"
              icon="pi pi-pencil"
              size="small"
              severity="secondary"
              variant="text"
              rounded
              :aria-label="`${book.title}の情報を編集`"
              :aria-controls="
                editingBookId === book.id
                  ? getMetadataDialogId(book)
                  : undefined
              "
              :aria-expanded="editingBookId === book.id"
              @click="emit('edit', book)"
            />
          </span>
          <span
            v-if="!canReadBook(book)"
            :id="getAvailabilityId(book)"
            class="availability"
          >
            {{ getBookSourceStatusMessage(book.status) }}
          </span>
          <span v-if="book.tags.length > 0" class="tags">
            <Chip
              v-for="tag in book.tags.slice(0, 3)"
              :key="tag"
              :label="tag"
            />
          </span>
          <span v-if="mode === 'collection'" class="actions">
            <NuxtLink
              class="action"
              :class="{ 'is-disabled': !canReadBook(book) }"
              :to="getReadRoute(book)"
              :aria-disabled="canReadBook(book) ? undefined : 'true'"
              @click="preventUnavailableRead($event, book)"
            >
              読む
            </NuxtLink>
            <NuxtLink class="action" :to="`/books/${book.id}`">詳細</NuxtLink>
            <Button
              label="上へ"
              icon="pi pi-arrow-up"
              size="small"
              severity="secondary"
              variant="text"
              :disabled="index === 0 || busyBookId !== null"
              @click="emit('moveUp', book)"
            />
            <Button
              label="下へ"
              icon="pi pi-arrow-down"
              size="small"
              severity="secondary"
              variant="text"
              :disabled="index === books.length - 1 || busyBookId !== null"
              @click="emit('moveDown', book)"
            />
            <Button
              label="外す"
              icon="pi pi-times"
              size="small"
              severity="danger"
              variant="text"
              :loading="busyBookId === book.id"
              :disabled="busyBookId !== null && busyBookId !== book.id"
              @click="emit('remove', book)"
            />
          </span>
          <span v-else-if="mode === 'archived'" class="actions">
            <Button
              label="元に戻す"
              icon="pi pi-replay"
              size="small"
              :loading="busyBookId === book.id"
              :disabled="busyBookId !== null && busyBookId !== undefined"
              @click="emit('restore', book)"
            />
          </span>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.book-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(11.5rem, 100%), 1fr));
  gap: 1rem;
  min-inline-size: 0;
  inline-size: 100%;
  padding: 0;
  margin: 0;
  list-style: none;
}

.item {
  min-inline-size: 0;
  content-visibility: auto;
  contain-intrinsic-size: auto 28rem;
}

.book {
  display: grid;
  gap: 0;
  min-inline-size: 0;
  min-block-size: 100%;
  overflow: hidden;
  border-block: 1px solid var(--bc-line-soft);
  border-inline-end: 1px solid var(--bc-line-soft);
  border-radius: 0.85rem;
  background: var(--bc-panel);
  box-shadow: var(--bc-shadow-low);
}

.cover-link,
.title,
.action {
  color: var(--text);
  text-decoration: none;
}

.cover {
  position: relative;
  display: grid;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  background: var(--panel);
}

.reading-progress {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  inline-size: 100%;
  block-size: 0.38rem;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  appearance: none;
  background: color-mix(in oklab, var(--bc-line-soft) 78%, transparent);
}

.reading-progress::-webkit-progress-bar {
  background: color-mix(in oklab, var(--bc-line-soft) 78%, transparent);
}

.reading-progress::-webkit-progress-value {
  background: var(--bc-ink-blue);
}

.reading-progress::-moz-progress-bar {
  background: var(--bc-ink-blue);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.empty {
  display: grid;
  align-content: space-between;
  gap: 0.75rem;
  width: 100%;
  height: 100%;
  padding: 0.8rem;
  color: var(--accent-strong);
  background: color-mix(in oklab, var(--panel) 80%, var(--accent) 8%);
}

.empty::before {
  display: block;
  width: 38%;
  height: 0.28rem;
  border-radius: 999px;
  background: currentColor;
  content: "";
  opacity: 0.4;
}

.mark {
  display: grid;
  place-items: center;
  justify-self: center;
  width: min(4rem, 100%);
  aspect-ratio: 1;
  border: 1px solid color-mix(in oklab, currentColor 28%, transparent);
  border-radius: 999px;
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
}

.details {
  display: flex;
  justify-content: space-between;
  gap: 0.35rem;
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.2;
}

.details span {
  overflow-wrap: anywhere;
}

.info {
  display: grid;
  gap: 0.15rem;
  align-content: start;
  padding: 0.65rem;
}

.title {
  overflow-wrap: anywhere;
  font-weight: 700;
}

.title:hover,
.action:hover {
  text-decoration: underline;
}

.authors {
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1.35;
}

.meta {
  color: var(--muted);
  font-size: 0.85rem;
}

.availability {
  margin-block-start: 0.15rem;
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  inline-size: 100%;
}

.edit-button {
  min-inline-size: 2.5rem;
  min-block-size: 2.5rem;
  margin-inline-start: auto;
}

.badge {
  display: inline-flex;
  align-items: center;
  min-block-size: 1.25rem;
  padding: 0 0.4rem;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.2;
}

.tags,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.actions {
  margin-block-start: auto;
  padding-block-start: 0.5rem;
}

.tag,
.action {
  display: inline-flex;
  align-items: center;
  min-block-size: 1.75rem;
  padding: 0 0.45rem;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 0.8rem;
  line-height: 1.2;
}

.tag {
  color: var(--muted);
  background: color-mix(in oklab, var(--panel) 80%, white);
}

.action {
  justify-content: center;
}

.cover-link.is-disabled,
.title.is-disabled,
.action.is-disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.cover-link.is-disabled:hover,
.title.is-disabled:hover,
.action.is-disabled:hover {
  text-decoration: none;
}

.is-error,
.is-missing {
  border-color: color-mix(in oklab, var(--danger) 45%, var(--line));
  color: var(--danger);
  background: color-mix(in oklab, var(--danger) 9%, transparent);
}

.is-scanning {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
  color: var(--text);
  background: color-mix(in oklab, var(--accent) 10%, transparent);
}

.is-reading,
.is-finished {
  color: var(--text);
}

.is-reading {
  border-color: color-mix(in oklab, var(--accent) 40%, var(--line));
  background: color-mix(in oklab, var(--accent) 10%, transparent);
}

.is-finished {
  border-color: color-mix(in oklab, var(--success) 35%, var(--line));
  background: color-mix(in oklab, var(--success) 9%, transparent);
}
</style>
