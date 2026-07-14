<script setup lang="ts">
import type {
  BookDetail,
  PageLayout,
  ReaderKeyboardAction
} from "@bookcafe/core";
import {
  clampPage,
  clampScale,
  createPageImageUrl,
  getAdjacentPages,
  getPageByStep,
  getReaderKeyboardAction,
  getSpreadAnchorPage,
  getVisibleReaderPages
} from "@bookcafe/core";
import { useElementSize, useSwipe } from "@vueuse/core";
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useId,
  useTemplateRef,
  watch
} from "vue";

import type { ComponentPublicInstance } from "vue";

import {
  getBookSourceStatusMessage,
  getBookSourceStatusTitle,
  isReadableBookStatus
} from "../utils/bookAvailability";

const { book } = defineProps<{
  book: BookDetail;
}>();
const emit = defineEmits<{
  pageChange: [currentPage: number];
}>();

const currentPage = ref(clampPage(book.currentPage, book.pageCount));
const direction = ref(book.readingDirection);
const mode = ref<"paged" | "vertical">("paged");
const layout = ref<PageLayout>("single");
const fit = ref<"contain" | "width" | "height" | "actual">("contain");
const scale = ref(1);
const pageInput = ref(String(currentPage.value));
const reader = useTemplateRef<HTMLElement>("reader");
const pageInputId = useId();
const { width } = useElementSize(reader);
const { direction: swipeDirection } = useSwipe(reader);
const pages = computed(() =>
  Array.from({ length: book.pageCount }, (_, index) => index + 1)
);
const visiblePages = computed(() =>
  mode.value === "paged"
    ? getVisibleReaderPages(currentPage.value, book.pageCount, layout.value)
    : [currentPage.value]
);
const lastVisiblePage = computed(
  () => visiblePages.value[visiblePages.value.length - 1] ?? currentPage.value
);
const pageLabel = computed(() =>
  visiblePages.value.length > 1
    ? `${visiblePages.value[0]}-${lastVisiblePage.value} / ${book.pageCount}`
    : `${currentPage.value} / ${book.pageCount}`
);
const pageProgressLabel = computed(
  () =>
    `${Math.round((lastVisiblePage.value / Math.max(book.pageCount, 1)) * 100)}%`
);
const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const preloadPages = computed(() => {
  const visiblePageSet = new Set(visiblePages.value);
  const preloadRadius = layout.value === "spread" ? 2 : 1;

  return getAdjacentPages(
    currentPage.value,
    book.pageCount,
    preloadRadius
  ).filter((pageNumber) => !visiblePageSet.has(pageNumber));
});
const scaleStyle = computed(() => ({ transform: `scale(${scale.value})` }));
const failedPages = ref<ReadonlySet<number>>(new Set());
const hasUnavailableSource = computed(() => !isReadableBookStatus(book.status));
const hasVisibleFailedPage = computed(() =>
  visiblePages.value.some((pageNumber) => failedPages.value.has(pageNumber))
);
const hasViewportNotice = computed(
  () =>
    hasUnavailableSource.value ||
    (mode.value === "paged" && hasVisibleFailedPage.value)
);
const issueTitle = computed(() =>
  hasUnavailableSource.value
    ? getBookSourceStatusTitle(book.status)
    : "Page unavailable"
);
const issueBody = computed(() =>
  hasUnavailableSource.value
    ? getBookSourceStatusMessage(book.status)
    : "This page image could not be read from the source file."
);
const readerClasses = computed(() => [
  "reader",
  `mode-${mode.value}`,
  `dir-${direction.value}`,
  `layout-${layout.value}`,
  `fit-${fit.value}`,
  {
    "is-zoomed": scale.value > 1,
    "has-error": hasViewportNotice.value
  }
]);

/**
 * Builds a page image URL for a one-based page number.
 */
const getPageUrl = (pageNumber: number): string =>
  createPageImageUrl(book.id, pageNumber);

useHead(() => ({
  link:
    mode.value === "paged" && !hasUnavailableSource.value
      ? preloadPages.value.map((pageNumber) => ({
          key: `book-page-${book.id}-${pageNumber}`,
          rel: "preload",
          as: "image",
          href: getPageUrl(pageNumber),
          fetchpriority: "low"
        }))
      : []
}));

const pageElements = new Map<number, HTMLElement>();
let pinchStartDistance = 0;
let pinchStartScale = 1;
let lastWheelAt = 0;
let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Tracks DOM elements for pages rendered in vertical mode.
 */
const setPageElement = (
  pageNumber: number,
  element: Element | ComponentPublicInstance | null
): void => {
  if (!element) {
    pageElements.delete(pageNumber);
    return;
  }

  const domElement =
    element instanceof HTMLElement
      ? element
      : "$el" in element
        ? element.$el
        : null;

  if (domElement instanceof HTMLElement) {
    pageElements.set(pageNumber, domElement);
  }
};

/**
 * Returns class tokens for a vertical-mode page frame.
 */
const getPageFrameClasses = (pageNumber: number) => [
  "frame",
  {
    "is-current": pageNumber === currentPage.value,
    "has-error": hasFailedPage(pageNumber)
  }
];

/**
 * Returns whether a rendered page failed to load its image.
 */
const hasFailedPage = (pageNumber: number): boolean =>
  failedPages.value.has(pageNumber);

/**
 * Marks one page image as unreadable for the current reader session.
 */
const handlePageImageError = (pageNumber: number): void => {
  const nextFailedPages = new Set(failedPages.value);
  nextFailedPages.add(pageNumber);
  failedPages.value = nextFailedPages;
};

/**
 * Clears a transient page image error after the image loads successfully.
 */
const clearPageImageError = (pageNumber: number): void => {
  if (!failedPages.value.has(pageNumber)) {
    return;
  }

  const nextFailedPages = new Set(failedPages.value);
  nextFailedPages.delete(pageNumber);
  failedPages.value = nextFailedPages;
};

/**
 * Retries loading every visible paged-mode image.
 */
const retryVisiblePages = (): void => {
  for (const pageNumber of visiblePages.value) {
    clearPageImageError(pageNumber);
  }
};

/**
 * Sets the zoom scale after applying reader bounds.
 */
const setScale = (nextScale: number): void => {
  scale.value = clampScale(nextScale);
};

/**
 * Increases the zoom scale by one reader step.
 */
const increaseScale = (): void => {
  setScale(scale.value + 0.25);
};

/**
 * Decreases the zoom scale by one reader step.
 */
const decreaseScale = (): void => {
  setScale(scale.value - 0.25);
};

/**
 * Restores the default page scale.
 */
const resetScale = (): void => {
  setScale(1);
};

/**
 * Normalizes a requested page for the active reader presentation.
 */
const normalizeReaderPage = (page: number): number =>
  mode.value === "paged" && layout.value === "spread"
    ? getSpreadAnchorPage(page, book.pageCount)
    : clampPage(page, book.pageCount);

/**
 * Moves to the page entered in the direct jump control.
 */
const commitPageInput = (): void => {
  if (hasUnavailableSource.value) {
    return;
  }

  const nextPageNumber = normalizeReaderPage(
    Number.parseInt(pageInput.value, 10)
  );
  pageInput.value = String(nextPageNumber);
  setCurrentPage(nextPageNumber, {
    scroll: mode.value === "vertical"
  });
};

/**
 * Sets the current page and emits the persisted page candidate.
 */
const setCurrentPage = (
  page: number,
  options: { emit?: boolean; scroll?: boolean } = {}
): void => {
  const nextPageNumber = normalizeReaderPage(page);

  if (nextPageNumber === currentPage.value) {
    return;
  }

  currentPage.value = nextPageNumber;
  if (options.emit !== false) {
    emit("pageChange", nextPageNumber);
  }

  if (options.scroll) {
    void scrollToPage(nextPageNumber);
  }
};

/**
 * Moves the reader to the next logical page.
 */
const nextPage = (): void => {
  if (hasUnavailableSource.value) {
    return;
  }

  const step =
    mode.value === "paged" && layout.value === "spread" && currentPage.value > 1
      ? 2
      : 1;
  const nextPageNumber =
    mode.value === "paged" &&
    layout.value === "spread" &&
    currentPage.value <= 1
      ? 2
      : getPageByStep(currentPage.value, book.pageCount, step);

  setCurrentPage(nextPageNumber, {
    scroll: mode.value === "vertical"
  });
};

/**
 * Moves the reader to the previous logical page.
 */
const previousPage = (): void => {
  if (hasUnavailableSource.value) {
    return;
  }

  const step = mode.value === "paged" && layout.value === "spread" ? -2 : -1;
  const nextPageNumber =
    mode.value === "paged" &&
    layout.value === "spread" &&
    currentPage.value <= 2
      ? 1
      : getPageByStep(currentPage.value, book.pageCount, step);

  setCurrentPage(nextPageNumber, {
    scroll: mode.value === "vertical"
  });
};

/**
 * Handles left and right arrow navigation based on reading direction.
 */
const handleArrow = (key: "left" | "right"): void => {
  const isNext = direction.value === "rtl" ? key === "left" : key === "right";
  if (isNext) {
    nextPage();
    return;
  }
  previousPage();
};

/**
 * Applies a normalized keyboard action to the reader.
 */
const applyReaderKeyboardAction = (action: ReaderKeyboardAction): void => {
  if (hasUnavailableSource.value) {
    return;
  }

  if (action === "next-page") {
    nextPage();
    return;
  }

  if (action === "previous-page") {
    previousPage();
    return;
  }

  if (action === "first-page") {
    setCurrentPage(1, { scroll: mode.value === "vertical" });
    return;
  }

  if (action === "last-page") {
    setCurrentPage(book.pageCount, { scroll: mode.value === "vertical" });
    return;
  }

  if (action === "zoom-in") {
    increaseScale();
    return;
  }

  if (action === "zoom-out") {
    decreaseScale();
    return;
  }

  resetScale();
};

/**
 * Returns whether keyboard shortcuts should stay out of the focused element.
 */
const shouldIgnoreReaderShortcut = (event: KeyboardEvent): boolean => {
  if (event.defaultPrevented || event.isComposing) {
    return true;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target.closest(
      "input, textarea, select, button, a[href], [contenteditable='true'], [role='textbox']"
    ) !== null
  );
};

/**
 * Handles global reader keyboard shortcuts while the reader is mounted.
 */
const handleReaderKeydown = (event: KeyboardEvent): void => {
  if (shouldIgnoreReaderShortcut(event)) {
    return;
  }

  const action = getReaderKeyboardAction({
    key: event.key,
    direction: direction.value,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey
  });

  if (!action) {
    return;
  }

  event.preventDefault();
  applyReaderKeyboardAction(action);
};

watch(swipeDirection, (value) => {
  if (value === "left") {
    handleArrow("left");
  }

  if (value === "right") {
    handleArrow("right");
  }
});

watch(mode, (nextMode) => {
  if (nextMode === "vertical") {
    void scrollToPage(currentPage.value);
    return;
  }

  if (layout.value === "spread") {
    setCurrentPage(currentPage.value, { emit: false });
  }
});

watch(layout, (nextLayout) => {
  if (nextLayout === "spread" && mode.value === "paged") {
    setCurrentPage(currentPage.value, { emit: false });
  }
});

watch(
  () => book.id,
  () => {
    pageElements.clear();
    failedPages.value = new Set();
    currentPage.value =
      mode.value === "paged" && layout.value === "spread"
        ? getSpreadAnchorPage(book.currentPage, book.pageCount)
        : clampPage(book.currentPage, book.pageCount);
    direction.value = book.readingDirection;
    resetScale();
  }
);

watch(currentPage, (pageNumber) => {
  pageInput.value = String(pageNumber);
});

/**
 * Uses the mouse wheel for page navigation.
 */
const handleWheel = (event: WheelEvent): void => {
  if (hasUnavailableSource.value) {
    return;
  }

  event.preventDefault();
  const now = Date.now();
  if (now - lastWheelAt < 250) {
    return;
  }
  lastWheelAt = now;

  if (event.deltaY > 0) {
    nextPage();
    return;
  }

  previousPage();
};

/**
 * Updates the active page after vertical scrolling rests.
 */
const handleScroll = (): void => {
  if (mode.value !== "vertical" || supportsNativeScrollEnd()) {
    return;
  }

  clearScrollEndTimer();
  scrollEndTimer = setTimeout(updateCurrentPageFromScroll, 120);
};

/**
 * Handles the native scrollend event when the browser supports it.
 */
const handleScrollEnd = (): void => {
  if (mode.value === "vertical") {
    updateCurrentPageFromScroll();
  }
};

/**
 * Starts a two-finger pinch gesture.
 */
const handleTouchStart = (event: TouchEvent): void => {
  if (hasUnavailableSource.value) {
    return;
  }

  if (event.touches.length !== 2) {
    return;
  }

  pinchStartDistance = getTouchDistance(event);
  pinchStartScale = scale.value;
};

/**
 * Updates the zoom scale during a pinch gesture.
 */
const handleTouchMove = (event: TouchEvent): void => {
  if (hasUnavailableSource.value) {
    return;
  }

  if (event.touches.length !== 2 || pinchStartDistance <= 0) {
    return;
  }

  event.preventDefault();
  const nextScale =
    (pinchStartScale * getTouchDistance(event)) / pinchStartDistance;
  setScale(nextScale);
};

/**
 * Ends a pinch gesture.
 */
const handleTouchEnd = (): void => {
  if (hasUnavailableSource.value) {
    return;
  }

  pinchStartDistance = 0;
  pinchStartScale = scale.value;
};

/**
 * Scrolls a vertical page into view after Vue has rendered it.
 */
const scrollToPage = async (pageNumber: number): Promise<void> => {
  if (mode.value !== "vertical") {
    return;
  }

  await nextTick();
  await waitForNextFrame();
  pageElements.get(pageNumber)?.scrollIntoView({
    block: "center",
    inline: "nearest"
  });
};

/**
 * Updates the current page from the page closest to the viewport center.
 */
const updateCurrentPageFromScroll = (): void => {
  const pageNumber = findCenteredPage();

  if (!pageNumber) {
    return;
  }

  setCurrentPage(pageNumber, { scroll: false });
};

/**
 * Finds the visible vertical page closest to the reader viewport center.
 */
const findCenteredPage = (): number | null => {
  const viewport = reader.value;

  if (!viewport) {
    return null;
  }

  const viewportRect = viewport.getBoundingClientRect();
  const viewportCenter = viewportRect.top + viewportRect.height / 2;
  let nearestPage: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const pageNumber of pages.value) {
    const element = pageElements.get(pageNumber);

    if (!element) {
      continue;
    }

    const pageRect = element.getBoundingClientRect();
    const visibleHeight =
      Math.min(pageRect.bottom, viewportRect.bottom) -
      Math.max(pageRect.top, viewportRect.top);

    if (visibleHeight <= 0) {
      continue;
    }

    const pageCenter = pageRect.top + pageRect.height / 2;
    const distance = Math.abs(pageCenter - viewportCenter);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPage = pageNumber;
    }
  }

  return nearestPage;
};

/**
 * Returns whether the browser has native scrollend support.
 */
const supportsNativeScrollEnd = (): boolean =>
  typeof window !== "undefined" && "onscrollend" in window;

/**
 * Clears the scrollend fallback timer.
 */
const clearScrollEndTimer = (): void => {
  if (!scrollEndTimer) {
    return;
  }

  clearTimeout(scrollEndTimer);
  scrollEndTimer = null;
};

/**
 * Waits for browser layout after Vue has flushed DOM changes.
 */
const waitForNextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Calculates the distance between the first two touches.
 */
const getTouchDistance = (event: TouchEvent): number => {
  const first = event.touches.item(0);
  const second = event.touches.item(1);

  if (!first || !second) {
    return 0;
  }

  return Math.hypot(
    first.clientX - second.clientX,
    first.clientY - second.clientY
  );
};

onMounted(() => {
  window.addEventListener("keydown", handleReaderKeydown);
});

onUnmounted(() => {
  clearScrollEndTimer();
  window.removeEventListener("keydown", handleReaderKeydown);
});
</script>

<template>
  <section
    :class="readerClasses"
    :style="{ '--reader-width': `${width}px` }"
    aria-label="Book reader"
  >
    <div class="toolbar">
      <div class="title">
        <strong>{{ book.title }}</strong>
        <span>{{ pageLabel }}</span>
        <span>{{ pageProgressLabel }}</span>
      </div>
      <div class="controls" aria-label="Reader controls">
        <button
          type="button"
          :disabled="hasUnavailableSource"
          @click="previousPage"
        >
          Prev
        </button>
        <button
          type="button"
          :disabled="hasUnavailableSource"
          @click="nextPage"
        >
          Next
        </button>
        <form
          class="jump"
          aria-label="Page jump"
          @submit.prevent="commitPageInput"
        >
          <label :for="pageInputId">Page</label>
          <input
            :id="pageInputId"
            v-model="pageInput"
            type="number"
            inputmode="numeric"
            min="1"
            :max="book.pageCount"
            step="1"
            required
            :disabled="hasUnavailableSource"
          />
          <span>/ {{ book.pageCount }}</span>
          <button type="submit" :disabled="hasUnavailableSource">Go</button>
        </form>
        <div class="zoom" aria-label="Zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            :disabled="hasUnavailableSource"
            @click="decreaseScale"
          >
            -
          </button>
          <output aria-label="Zoom scale">{{ zoomLabel }}</output>
          <button
            type="button"
            aria-label="Zoom in"
            :disabled="hasUnavailableSource"
            @click="increaseScale"
          >
            +
          </button>
          <button
            type="button"
            :disabled="hasUnavailableSource"
            @click="resetScale"
          >
            100%
          </button>
        </div>
        <select v-model="direction" aria-label="Reading direction">
          <option value="rtl">RTL</option>
          <option value="ltr">LTR</option>
        </select>
        <select v-model="mode" aria-label="Reader mode">
          <option value="paged">Paged</option>
          <option value="vertical">Vertical</option>
        </select>
        <select
          v-if="mode === 'paged'"
          v-model="layout"
          aria-label="Page layout"
        >
          <option value="single">Single</option>
          <option value="spread">Spread</option>
        </select>
        <select v-model="fit" aria-label="Image fit">
          <option value="contain">Fit page</option>
          <option value="width">Fit width</option>
          <option value="height">Fit height</option>
          <option value="actual">Actual size</option>
        </select>
      </div>
    </div>
    <div
      ref="reader"
      class="viewport"
      tabindex="0"
      @scroll.passive="handleScroll"
      @scrollend="handleScrollEnd"
      @wheel="handleWheel"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <div
        v-if="hasUnavailableSource"
        class="notice"
        role="status"
        aria-live="polite"
      >
        <strong>{{ issueTitle }}</strong>
        <span>{{ issueBody }}</span>
        <NuxtLink to="/">Library</NuxtLink>
      </div>
      <div
        v-else-if="mode === 'paged' && hasVisibleFailedPage"
        class="notice"
        role="status"
        aria-live="polite"
      >
        <strong>{{ issueTitle }}</strong>
        <span>{{ issueBody }}</span>
        <button type="button" @click="retryVisiblePages">Retry</button>
      </div>
      <div
        v-else-if="mode === 'paged'"
        class="spread"
        :style="scaleStyle"
        :aria-label="pageLabel"
      >
        <img
          v-for="pageNumber in visiblePages"
          :key="pageNumber"
          class="page"
          :class="{ 'is-spread': visiblePages.length > 1 }"
          :src="getPageUrl(pageNumber)"
          :alt="`${book.title} page ${pageNumber}`"
          width="960"
          height="1440"
          loading="eager"
          fetchpriority="high"
          decoding="async"
          draggable="false"
          @error="handlePageImageError(pageNumber)"
          @load="clearPageImageError(pageNumber)"
        />
      </div>
      <div v-else class="pages" :style="scaleStyle">
        <div
          v-for="pageNumber in pages"
          :key="pageNumber"
          :ref="(element) => setPageElement(pageNumber, element)"
          :class="getPageFrameClasses(pageNumber)"
          :data-page="pageNumber"
        >
          <div
            v-if="hasFailedPage(pageNumber)"
            class="notice"
            role="status"
            aria-live="polite"
          >
            <strong>Page unavailable</strong>
            <span>This page image could not be read from the source file.</span>
          </div>
          <img
            v-else
            class="page"
            :src="getPageUrl(pageNumber)"
            :alt="`${book.title} page ${pageNumber}`"
            width="960"
            height="1440"
            :loading="pageNumber === currentPage ? 'eager' : 'lazy'"
            :fetchpriority="pageNumber === currentPage ? 'high' : undefined"
            decoding="async"
            draggable="false"
            @error="handlePageImageError(pageNumber)"
            @load="clearPageImageError(pageNumber)"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.reader {
  display: grid;
  height: calc(100dvh - var(--app-topbar-height, 4rem));
  min-height: 0;
  grid-template-rows: auto 1fr;
  color: var(--reader-text);
  background: var(--reader-bg);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #363636;
  background: var(--reader-panel);
}

.title {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}

.title strong {
  overflow-wrap: anywhere;
}

.title span {
  color: #cfcac0;
  font-size: 0.9rem;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.controls button,
.controls select,
.jump input {
  min-height: 2.25rem;
  border: 1px solid #555;
  border-radius: 6px;
  color: var(--reader-text);
  background: #303030;
}

.controls button {
  padding: 0 0.75rem;
  cursor: pointer;
}

.controls button:disabled,
.jump input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.controls select {
  padding: 0 0.5rem;
}

.jump,
.zoom {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.25rem;
}

.jump label,
.jump span,
.zoom output {
  color: #cfcac0;
  font-size: 0.9rem;
  line-height: 1;
  white-space: nowrap;
}

.jump input {
  width: 4.5rem;
  padding: 0 0.5rem;
}

.jump button,
.zoom button {
  min-width: 2.25rem;
}

.zoom output {
  min-width: 3rem;
  text-align: center;
}

.viewport {
  display: grid;
  place-items: center;
  min-height: 0;
  overflow: hidden;
  touch-action: pan-y pinch-zoom;
  outline-offset: -4px;
}

.page {
  transform-origin: center center;
  transition: transform 120ms ease-out;
  object-fit: contain;
  user-select: none;
}

.spread {
  --spread-gap: clamp(0.25rem, 1vw, 1rem);

  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spread-gap);
  width: 100%;
  max-width: 100%;
  max-height: calc(100dvh - var(--app-topbar-height, 4rem) - 4.6rem);
  transform-origin: center center;
  transition: transform 120ms ease-out;
}

.dir-rtl .spread {
  flex-direction: row-reverse;
}

.spread .page {
  min-width: 0;
}

.spread .page.is-spread {
  max-width: calc((100% - var(--spread-gap)) / 2);
}

.fit-contain .page {
  max-width: min(100%, 980px);
  max-height: calc(100dvh - var(--app-topbar-height, 4rem) - 4.6rem);
}

.fit-contain .spread .page.is-spread {
  max-width: min(calc((100% - var(--spread-gap)) / 2), 980px);
}

.fit-width .page {
  width: min(100%, 980px);
  max-width: 100%;
  height: auto;
  max-height: none;
}

.fit-width .spread .page.is-spread {
  width: calc((100% - var(--spread-gap)) / 2);
  max-width: calc((100% - var(--spread-gap)) / 2);
}

.fit-height .page {
  width: auto;
  max-width: none;
  height: calc(100dvh - var(--app-topbar-height, 4rem) - 4.6rem);
  max-height: 100%;
}

.fit-height .spread .page.is-spread {
  max-width: calc((100% - var(--spread-gap)) / 2);
}

.fit-actual .page {
  width: auto;
  max-width: none;
  height: auto;
  max-height: none;
}

.mode-vertical .viewport {
  overflow-y: auto;
  align-items: start;
  padding: 1rem 0;
}

.pages {
  display: grid;
  gap: 1rem;
  width: min(100%, 980px);
  margin: 0 auto;
  transform-origin: top center;
  transition: transform 120ms ease-out;
}

.frame {
  display: grid;
  place-items: center;
  min-height: 12rem;
  contain-intrinsic-size: 960px 1440px;
  content-visibility: auto;
  scroll-margin: 1rem;
}

.frame.is-current {
  scroll-initial-target: nearest;
}

.mode-vertical .page {
  max-height: none;
}

.mode-vertical.fit-contain .page,
.mode-vertical.fit-width .page {
  width: min(100%, 980px);
  max-width: 100%;
  height: auto;
}

.mode-vertical.fit-height .page {
  width: auto;
  max-width: none;
  height: calc(100dvh - var(--app-topbar-height, 4rem) - 4.6rem);
}

.mode-vertical.fit-actual .page {
  width: auto;
  max-width: none;
  height: auto;
}

.is-zoomed .viewport {
  overflow: auto;
}

.has-error .viewport {
  overflow: hidden;
  place-items: center;
  padding: 1rem;
}

.notice {
  display: grid;
  gap: 0.6rem;
  width: min(28rem, 100%);
  padding: 1rem;
  border: 1px solid color-mix(in oklab, var(--danger) 48%, #363636);
  border-radius: 6px;
  color: var(--reader-text);
  background: color-mix(in oklab, var(--danger) 12%, var(--reader-panel));
}

.notice strong {
  color: var(--danger);
}

.notice span {
  overflow-wrap: anywhere;
  color: #ddd6ca;
  line-height: 1.45;
}

.notice a,
.notice button {
  justify-self: start;
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid #555;
  border-radius: 6px;
  color: var(--reader-text);
  background: #303030;
}

.notice a {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.notice button {
  cursor: pointer;
}

@media (max-width: 720px) {
  .toolbar {
    align-items: start;
    flex-direction: column;
  }

  .controls {
    justify-content: start;
  }
}
</style>
