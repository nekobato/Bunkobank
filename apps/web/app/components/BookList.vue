<script setup lang="ts">
import type { BookSummary } from "@bookcafe/core";

import {
  getBookSourceStatusLabel,
  getBookSourceStatusMessage,
  isReadableBookStatus
} from "../utils/bookAvailability";
import { createBookCoverPlaceholder } from "../utils/bookCover";

defineProps<{
  books: BookSummary[];
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
  canReadBook(book) ? `/books/${book.id}/read` : undefined;

/**
 * Formats the persisted reading status for library cards.
 */
const getReadingStatusLabel = (
  readingStatus: BookSummary["readingStatus"]
): string => {
  switch (readingStatus) {
    case "finished":
      return "Finished";
    case "reading":
      return "Reading";
    default:
      return "Unread";
  }
};

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
    ? `Read ${book.title}`
    : getCoverPlaceholder(book).accessibleName;

/**
 * Creates a stable id for the source availability text on one card.
 */
const getAvailabilityId = (book: BookSummary): string =>
  `book-${book.id}-availability`;

/**
 * Stops reader navigation while keeping unavailable read links discoverable.
 */
const preventUnavailableRead = (event: Event, book: BookSummary): void => {
  if (canReadBook(book)) {
    return;
  }

  event.preventDefault();
};
</script>

<template>
  <ul class="book-list" aria-label="Books">
    <li v-for="book in books" :key="book.id" class="item">
      <div class="book">
        <NuxtLink
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
          </span>
        </NuxtLink>
        <div class="info">
          <NuxtLink
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
          <span v-if="book.authors.length > 0" class="authors">
            {{ getAuthorsLabel(book.authors) }}
          </span>
          <span class="line">
            <span class="meta">{{ book.pageCount }} pages</span>
            <span
              class="badge"
              :class="{
                'is-reading': book.readingStatus === 'reading',
                'is-finished': book.readingStatus === 'finished'
              }"
            >
              {{ getReadingStatusLabel(book.readingStatus) }}
            </span>
            <span
              v-if="book.status !== 'ready'"
              class="badge"
              :class="{
                'is-error': book.status === 'error',
                'is-missing': book.status === 'missing',
                'is-scanning': book.status === 'scanning'
              }"
            >
              {{ getBookSourceStatusLabel(book.status) }}
            </span>
          </span>
          <span
            v-if="!canReadBook(book)"
            :id="getAvailabilityId(book)"
            class="availability"
          >
            {{ getBookSourceStatusMessage(book.status) }}
          </span>
          <span v-if="book.tags.length > 0" class="tags">
            <span v-for="tag in book.tags.slice(0, 3)" :key="tag" class="tag">
              {{ tag }}
            </span>
          </span>
          <span class="actions">
            <NuxtLink
              class="action"
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
              Read
            </NuxtLink>
            <NuxtLink class="action" :to="`/books/${book.id}`">
              Details
            </NuxtLink>
          </span>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.book-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.item {
  min-width: 0;
}

.book {
  display: grid;
  gap: 0.75rem;
}

.cover-link,
.title,
.action {
  color: var(--text);
  text-decoration: none;
}

.cover {
  display: grid;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
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
