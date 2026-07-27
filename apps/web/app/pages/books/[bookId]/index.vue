<script setup lang="ts">
import {
  getAccessErrorMessage,
  getApiErrorMessage
} from "../../../utils/apiErrors";
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
const { selectedLibraryId } = useLibraries();
const { archiveBook, getBook, updateBookMetadata } = useBookApi();
const { data, error, pending, refresh } = await useAsyncData(
  `book-metadata-${bookId.value}`,
  () =>
    selectedLibraryId.value
      ? getBook(selectedLibraryId.value, bookId.value)
      : Promise.resolve(null),
  {
    server: false,
    watch: [selectedLibraryId]
  }
);
const form = ref<MetadataForm>(createEmptyMetadataForm());
const saving = ref(false);
const archiveDialogOpen = ref(false);
const archiving = ref(false);
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
const hasUnsavedChanges = computed(() =>
  data.value
    ? JSON.stringify(form.value) !== JSON.stringify(toMetadataForm(data.value))
    : false
);
const actionLink = computed(() => {
  if (statusCode.value === 409) {
    return { label: "設定を開く", to: "/setup" };
  }

  if (statusCode.value === 401) {
    return { label: "ログイン", to: "/login" };
  }

  return null;
});
const errorMessage = computed(() =>
  getAccessErrorMessage(
    statusCode.value,
    getApiErrorMessage(error.value, "書籍を読み込めませんでした。")
  )
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
    if (!selectedLibraryId.value) {
      return;
    }

    const book = await updateBookMetadata(
      selectedLibraryId.value,
      bookId.value,
      toMetadataRequest(form.value)
    );
    data.value = book;
    form.value = toMetadataForm(book);
    statusMessage.value = "書誌情報を保存しました。";
  } catch (error) {
    formError.value = getApiErrorMessage(
      error,
      "書誌情報を保存できませんでした。"
    );
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

/** Archives the current book and returns to the normal list. */
const confirmArchive = async (): Promise<void> => {
  if (!data.value || !selectedLibraryId.value) {
    return;
  }

  archiving.value = true;
  formError.value = "";

  try {
    await archiveBook(selectedLibraryId.value, data.value.id);
    archiveDialogOpen.value = false;
    await navigateTo("/");
  } catch (error) {
    formError.value = getApiErrorMessage(error, "アーカイブできませんでした。");
  } finally {
    archiving.value = false;
  }
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

/** Warns before a browser unload would discard metadata edits. */
const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
  if (!hasUnsavedChanges.value) {
    return;
  }

  event.preventDefault();
};

onBeforeRouteLeave(() =>
  hasUnsavedChanges.value
    ? window.confirm(
        "保存していない書誌情報があります。このページを離れますか？"
      )
    : true
);

onMounted(() => window.addEventListener("beforeunload", warnBeforeUnload));
onUnmounted(() => window.removeEventListener("beforeunload", warnBeforeUnload));
</script>

<template>
  <section class="detail">
    <ClientOnly>
      <div v-if="pending" class="status" role="status">
        <ProgressSpinner class="spinner" stroke-width="4" />
        <span>書籍を読み込んでいます。</span>
      </div>
      <Message v-else-if="error" severity="error" :closable="false">
        <span>{{ errorMessage }}</span>
        <NuxtLink v-if="actionLink" :to="actionLink.to">
          {{ actionLink.label }}
        </NuxtLink>
      </Message>
      <template v-else-if="data">
        <header class="heading">
          <div>
            <p class="page-eyebrow">{{ data.format }}</p>
            <h1 class="page-title">{{ data.title }}</h1>
            <p class="source">{{ data.relativePath }}</p>
          </div>
          <nav class="links" aria-label="書籍の操作">
            <NuxtLink to="/">ライブラリ</NuxtLink>
            <NuxtLink
              :to="readRoute"
              :class="{ 'is-disabled': !canReadBook }"
              :role="canReadBook ? undefined : 'link'"
              :tabindex="canReadBook ? undefined : 0"
              :aria-disabled="canReadBook ? undefined : 'true'"
              :aria-describedby="canReadBook ? undefined : sourceIssueId"
              @click="preventUnavailableRead"
            >
              読む
            </NuxtLink>
            <Button
              v-if="!data.archivedAt"
              label="アーカイブ"
              icon="pi pi-inbox"
              severity="secondary"
              variant="text"
              @click="archiveDialogOpen = true"
            />
          </nav>
        </header>

        <p
          v-if="!canReadBook"
          :id="sourceIssueId"
          class="source-alert"
          role="status"
          aria-live="polite"
        >
          <Tag
            :value="getBookSourceStatusLabel(data.status)"
            severity="warn"
            rounded
          />
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
            <legend>書誌情報</legend>
            <label class="field" for="book-title">
              <span>タイトル</span>
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
              <span>著者</span>
              <textarea
                id="book-authors"
                v-model="form.authors"
                name="authors"
                rows="4"
                maxlength="10000"
                autocomplete="off"
                aria-describedby="authors-help"
              />
              <small id="authors-help"> 1行またはカンマで区切ります。 </small>
            </label>
            <div class="split">
              <label class="field" for="book-publisher">
                <span>出版社</span>
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
              <span>購入日</span>
              <input
                id="book-purchased-at"
                v-model="form.purchasedAt"
                name="purchasedAt"
                type="date"
                autocomplete="off"
              />
            </label>
          </fieldset>

          <fieldset class="group">
            <legend>読書記録</legend>
            <div class="choices" role="radiogroup" aria-label="読書状況">
              <label class="choice" for="reading-unread">
                <input
                  id="reading-unread"
                  v-model="form.readingStatus"
                  name="readingStatus"
                  type="radio"
                  value="unread"
                />
                <span>未読</span>
              </label>
              <label class="choice" for="reading-reading">
                <input
                  id="reading-reading"
                  v-model="form.readingStatus"
                  name="readingStatus"
                  type="radio"
                  value="reading"
                />
                <span>読書中</span>
              </label>
              <label class="choice" for="reading-finished">
                <input
                  id="reading-finished"
                  v-model="form.readingStatus"
                  name="readingStatus"
                  type="radio"
                  value="finished"
                />
                <span>読了</span>
              </label>
            </div>
            <label class="field" for="book-tags">
              <span>タグ</span>
              <input
                id="book-tags"
                v-model="form.tags"
                name="tags"
                type="text"
                maxlength="3200"
                autocomplete="off"
                aria-describedby="tags-help"
              />
              <small id="tags-help">カンマ区切り</small>
            </label>
            <label class="field" for="book-notes">
              <span>メモ</span>
              <textarea
                id="book-notes"
                v-model="form.notes"
                name="notes"
                rows="6"
                maxlength="10000"
                autocomplete="off"
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
            <Button
              label="変更を保存"
              icon="pi pi-check"
              type="submit"
              :loading="saving"
            />
            <Button
              label="元に戻す"
              icon="pi pi-undo"
              type="button"
              severity="secondary"
              variant="outlined"
              @click="resetMetadata"
            />
            <Button
              label="再読み込み"
              icon="pi pi-refresh"
              type="button"
              severity="secondary"
              variant="text"
              @click="() => refresh()"
            />
          </div>
        </form>
      </template>
      <template #fallback>
        <div class="status" role="status">
          <ProgressSpinner class="spinner" stroke-width="4" />
          <span>書籍を読み込んでいます。</span>
        </div>
      </template>
    </ClientOnly>

    <Dialog
      v-model:visible="archiveDialogOpen"
      modal
      header="アーカイブ"
      :style="{ width: 'min(28rem, calc(100vw - 2rem))' }"
    >
      <p class="dialog-copy">「{{ data?.title }}」を非表示にします。</p>
      <template #footer>
        <Button
          label="キャンセル"
          severity="secondary"
          variant="text"
          @click="archiveDialogOpen = false"
        />
        <Button
          label="アーカイブ"
          icon="pi pi-inbox"
          :loading="archiving"
          @click="confirmArchive"
        />
      </template>
    </Dialog>
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

.dialog-copy {
  margin: 0;
  color: var(--bc-ink-soft);
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

<style scoped>
.detail {
  gap: 1.5rem;
  inline-size: min(72rem, 100%);
  padding: clamp(1.25rem, 4vw, 3.5rem);
}

.heading {
  align-items: end;
  border-block-end: 1px solid var(--bc-line-soft);
  padding-block-end: 1.5rem;
}

.heading h1 {
  max-inline-size: 20ch;
  margin-block-start: 0.35rem;
}

.source {
  max-inline-size: 64rem;
  margin-block-start: 0.65rem;
  color: var(--bc-ink-soft);
  font-family: var(--bc-font-data);
  font-size: 0.72rem;
}

.links a {
  border-color: var(--bc-line);
  border-radius: 0.6rem;
  background: var(--bc-panel);
  padding-inline: 0.9rem;
  font-weight: 700;
}

.links a:last-child:not(.is-disabled) {
  border-color: var(--bc-ink-blue);
  background: var(--bc-ink-blue);
  color: white;
}

.source-alert {
  border-color: color-mix(in oklab, var(--bc-warning) 40%, var(--bc-line));
  border-inline-start: 0.35rem solid var(--bc-warning);
  border-radius: 0.75rem;
  background: color-mix(in oklab, var(--bc-warning) 7%, var(--bc-panel));
}

.form {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}

.group {
  min-inline-size: 0;
  border-color: var(--bc-line-soft);
  border-radius: 0.85rem;
  background: var(--bc-panel);
  padding: clamp(1rem, 2.5vw, 1.5rem);
  box-shadow: var(--bc-shadow-low);
}

.group legend {
  padding-inline: 0.45rem;
  font-family: var(--bc-font-display);
  font-size: 1rem;
}

.field span {
  color: var(--bc-ink-soft);
  font-size: 0.8rem;
}

.field input,
.field textarea {
  border-color: var(--bc-line);
  border-radius: 0.65rem;
}

.choice {
  border-color: var(--bc-line);
  border-radius: 0.6rem;
}

.choice:has(input:checked) {
  border-color: var(--bc-ink-blue);
  background: color-mix(in oklab, var(--bc-ink-blue) 7%, var(--bc-panel));
}

.notice,
.actions {
  grid-column: 1 / -1;
}

.notice {
  border-radius: 0.7rem;
}

.spinner {
  inline-size: 2rem;
  block-size: 2rem;
}

@media (width <= 48rem) {
  .form {
    grid-template-columns: minmax(0, 1fr);
  }

  .notice,
  .actions {
    grid-column: auto;
  }
}
</style>
