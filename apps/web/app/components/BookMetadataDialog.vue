<script setup lang="ts">
import {
  updateBookMetadataRequestSchema,
  type BookDetailResponse
} from "@bunkobank/contracts";
import type { BookSummary } from "@bunkobank/core";

import { getApiErrorMessage } from "../utils/apiErrors";
import { createFieldErrorMap } from "../utils/formValidation";
import {
  createEmptyMetadataForm,
  toMetadataForm,
  toMetadataRequest,
  type MetadataForm
} from "../utils/metadataForm";

const { book, libraryId } = defineProps<{
  book: BookSummary | null;
  libraryId: string | null;
}>();
const visible = defineModel<boolean>("visible", { required: true });
const emit = defineEmits<{
  updated: [book: BookDetailResponse];
}>();
const { getBook, updateBookMetadata } = useBookApi();
const detail = ref<BookDetailResponse | null>(null);
const form = ref<MetadataForm>(createEmptyMetadataForm());
const loading = ref(false);
const saving = ref(false);
const loadError = ref("");
const formError = ref("");
const statusMessage = ref("");
const fieldErrors = ref<Record<string, string>>({});
const errorSummary = useTemplateRef<HTMLElement>("error-summary");
let loadSequence = 0;

const dialogId = computed(() =>
  book ? `book-${book.id}-metadata-dialog` : "book-metadata-dialog"
);
const dialogTitle = computed(() =>
  detail.value || book
    ? `${detail.value?.title ?? book?.title}を編集`
    : "書籍を編集"
);
const hasUnsavedChanges = computed(() =>
  detail.value
    ? JSON.stringify(form.value) !==
      JSON.stringify(toMetadataForm(detail.value))
    : false
);
const fieldTargets: Record<string, string> = {
  title: "dialog-book-title",
  authors: "dialog-book-authors",
  publisher: "dialog-book-publisher",
  isbn: "dialog-book-isbn",
  purchasedAt: "dialog-book-purchased-at",
  readingStatus: "dialog-reading-unread",
  tags: "dialog-book-tags",
  notes: "dialog-book-notes"
};
const fieldLabels: Record<string, string> = {
  title: "タイトル",
  authors: "著者",
  publisher: "出版社",
  isbn: "ISBN",
  purchasedAt: "購入日",
  readingStatus: "読書状況",
  tags: "タグ",
  notes: "メモ",
  form: "入力内容"
};
const fieldErrorEntries = computed(() =>
  Object.entries(fieldErrors.value).map(([field, message]) => ({
    field,
    message,
    label: fieldLabels[field] ?? field,
    target: fieldTargets[field]
  }))
);

/**
 * Loads the complete metadata required by the edit form.
 */
const loadMetadata = async (): Promise<void> => {
  const targetBookId = book?.id;
  const targetLibraryId = libraryId;

  if (!targetBookId || !targetLibraryId) {
    return;
  }

  const sequence = ++loadSequence;
  loading.value = true;
  loadError.value = "";
  formError.value = "";
  statusMessage.value = "";
  fieldErrors.value = {};

  try {
    const loadedBook = await getBook(targetLibraryId, targetBookId);

    if (
      sequence !== loadSequence ||
      !visible.value ||
      book?.id !== targetBookId
    ) {
      return;
    }

    detail.value = loadedBook;
    form.value = toMetadataForm(loadedBook);
  } catch (error) {
    if (sequence === loadSequence) {
      loadError.value = getApiErrorMessage(
        error,
        "書籍情報を読み込めませんでした。"
      );
    }
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
    }
  }
};

watch(
  () => visible.value,
  (isVisible) => {
    if (isVisible) {
      detail.value = null;
      void loadMetadata();
    } else {
      loadSequence += 1;
    }
  }
);

/**
 * Keeps the dialog open when closing would discard edits.
 */
const updateVisibility = (nextVisible: boolean): void => {
  if (
    !nextVisible &&
    hasUnsavedChanges.value &&
    !window.confirm("保存していない書誌情報があります。閉じますか？")
  ) {
    return;
  }

  visible.value = nextVisible;
};

/**
 * Saves validated metadata through the existing book API.
 */
const saveMetadata = async (): Promise<void> => {
  if (!detail.value || !libraryId || saving.value) {
    return;
  }

  statusMessage.value = "";
  formError.value = "";
  const validation = updateBookMetadataRequestSchema.safeParse(
    toMetadataRequest(form.value)
  );

  if (!validation.success) {
    fieldErrors.value = localizeFieldErrors(
      createFieldErrorMap(validation.error.issues)
    );
    await nextTick();
    errorSummary.value?.focus();
    return;
  }

  saving.value = true;
  fieldErrors.value = {};

  try {
    const updatedBook = await updateBookMetadata(
      libraryId,
      detail.value.id,
      validation.data
    );
    detail.value = updatedBook;
    form.value = toMetadataForm(updatedBook);
    statusMessage.value = "書誌情報を保存しました。";
    emit("updated", updatedBook);
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
 * Converts shared schema issues into concise Japanese guidance.
 */
const localizeFieldErrors = (
  errors: Record<string, string>
): Record<string, string> => ({
  ...(errors.title
    ? { title: "タイトルを1〜300文字で入力してください。" }
    : {}),
  ...(errors.authors
    ? { authors: "著者は1件200文字以内、50件までで入力してください。" }
    : {}),
  ...(errors.publisher
    ? { publisher: "出版社は200文字以内で入力してください。" }
    : {}),
  ...(errors.isbn ? { isbn: "ISBNは32文字以内で入力してください。" } : {}),
  ...(errors.purchasedAt
    ? { purchasedAt: "購入日は有効な日付で入力してください。" }
    : {}),
  ...(errors.readingStatus
    ? { readingStatus: "読書状況を選択してください。" }
    : {}),
  ...(errors.tags
    ? { tags: "タグは1件64文字以内、50件までで入力してください。" }
    : {}),
  ...(errors.notes ? { notes: "メモは10000文字以内で入力してください。" } : {}),
  ...(errors.form ? { form: "入力内容を確認してください。" } : {})
});
</script>

<template>
  <ElDialog
    :id="dialogId"
    :model-value="visible"
    :title="dialogTitle"
    :draggable="false"
    width="min(44rem, calc(100vw - 2rem))"
    @update:model-value="updateVisibility"
  >
    <div v-if="loading" class="loading" role="status">
      <LoadingIndicator class="spinner" />
      <span>書籍情報を読み込んでいます。</span>
    </div>
    <ElAlert v-else-if="loadError" type="error" :closable="false" show-icon>
      {{ loadError }}
      <ElButton :icon="ElIconRefresh" size="small" @click="loadMetadata">
        再試行
      </ElButton>
    </ElAlert>
    <form
      v-else-if="detail"
      id="book-metadata-dialog-form"
      class="form"
      method="post"
      :action="`/books/${detail.id}`"
      @submit.prevent="saveMetadata"
    >
      <dl class="source-details">
        <div>
          <dt>形式</dt>
          <dd>{{ detail.format }}</dd>
        </div>
        <div>
          <dt>ページ数</dt>
          <dd>{{ detail.pageCount }}ページ</dd>
        </div>
        <div class="path">
          <dt>元ファイル</dt>
          <dd>{{ detail.relativePath }}</dd>
        </div>
      </dl>

      <div
        v-if="fieldErrorEntries.length > 0"
        ref="error-summary"
        class="error-summary"
        tabindex="-1"
        role="alert"
      >
        <strong>入力内容を確認してください。</strong>
        <ul>
          <li v-for="entry in fieldErrorEntries" :key="entry.field">
            <a v-if="entry.target" :href="`#${entry.target}`">
              {{ entry.label }}: {{ entry.message }}
            </a>
            <span v-else>{{ entry.message }}</span>
          </li>
        </ul>
      </div>

      <fieldset class="group">
        <legend>書誌情報</legend>
        <label class="field" for="dialog-book-title">
          <span>タイトル</span>
          <ElInput
            id="dialog-book-title"
            v-model="form.title"
            name="title"
            type="text"
            required
            maxlength="300"
            autocomplete="off"
            autofocus
            :aria-invalid="Boolean(fieldErrors.title)"
            aria-describedby="dialog-book-title-error"
            class="fluid-control"
            :class="{ 'is-invalid': Boolean(fieldErrors.title) }"
          />
          <small v-if="fieldErrors.title" id="dialog-book-title-error">
            {{ fieldErrors.title }}
          </small>
        </label>
        <label class="field" for="dialog-book-authors">
          <span>著者</span>
          <ElInput
            id="dialog-book-authors"
            v-model="form.authors"
            name="authors"
            type="textarea"
            :rows="3"
            maxlength="10000"
            autocomplete="off"
            :aria-invalid="Boolean(fieldErrors.authors)"
            aria-describedby="dialog-authors-help dialog-book-authors-error"
            class="fluid-control"
            :class="{ 'is-invalid': Boolean(fieldErrors.authors) }"
          />
          <small id="dialog-authors-help">
            1行またはカンマで区切ります。
          </small>
          <small v-if="fieldErrors.authors" id="dialog-book-authors-error">
            {{ fieldErrors.authors }}
          </small>
        </label>
        <div class="split">
          <label class="field" for="dialog-book-publisher">
            <span>出版社</span>
            <ElInput
              id="dialog-book-publisher"
              v-model="form.publisher"
              name="publisher"
              type="text"
              maxlength="200"
              autocomplete="organization"
              :aria-invalid="Boolean(fieldErrors.publisher)"
              aria-describedby="dialog-book-publisher-error"
              class="fluid-control"
              :class="{ 'is-invalid': Boolean(fieldErrors.publisher) }"
            />
            <small
              v-if="fieldErrors.publisher"
              id="dialog-book-publisher-error"
            >
              {{ fieldErrors.publisher }}
            </small>
          </label>
          <label class="field" for="dialog-book-isbn">
            <span>ISBN</span>
            <ElInput
              id="dialog-book-isbn"
              v-model="form.isbn"
              name="isbn"
              type="text"
              maxlength="32"
              autocomplete="off"
              inputmode="numeric"
              :aria-invalid="Boolean(fieldErrors.isbn)"
              aria-describedby="dialog-book-isbn-error"
              class="fluid-control"
              :class="{ 'is-invalid': Boolean(fieldErrors.isbn) }"
            />
            <small v-if="fieldErrors.isbn" id="dialog-book-isbn-error">
              {{ fieldErrors.isbn }}
            </small>
          </label>
        </div>
        <label class="field" for="dialog-book-purchased-at">
          <span>購入日</span>
          <ElInput
            id="dialog-book-purchased-at"
            v-model="form.purchasedAt"
            name="purchasedAt"
            type="date"
            autocomplete="off"
            :aria-invalid="Boolean(fieldErrors.purchasedAt)"
            aria-describedby="dialog-book-purchased-at-error"
            class="fluid-control"
            :class="{ 'is-invalid': Boolean(fieldErrors.purchasedAt) }"
          />
          <small
            v-if="fieldErrors.purchasedAt"
            id="dialog-book-purchased-at-error"
          >
            {{ fieldErrors.purchasedAt }}
          </small>
        </label>
      </fieldset>

      <fieldset class="group">
        <legend>読書記録</legend>
        <div
          class="choices"
          role="radiogroup"
          aria-label="読書状況"
          :aria-invalid="Boolean(fieldErrors.readingStatus)"
          aria-describedby="dialog-reading-status-error"
        >
          <ElRadio
            id="dialog-reading-unread"
            v-model="form.readingStatus"
            class="choice"
            name="readingStatus"
            value="unread"
          >
            未読
          </ElRadio>
          <ElRadio
            id="dialog-reading-reading"
            v-model="form.readingStatus"
            class="choice"
            name="readingStatus"
            value="reading"
          >
            読書中
          </ElRadio>
          <ElRadio
            id="dialog-reading-finished"
            v-model="form.readingStatus"
            class="choice"
            name="readingStatus"
            value="finished"
          >
            読了
          </ElRadio>
        </div>
        <small
          v-if="fieldErrors.readingStatus"
          id="dialog-reading-status-error"
        >
          {{ fieldErrors.readingStatus }}
        </small>
        <label class="field" for="dialog-book-tags">
          <span>タグ</span>
          <ElInput
            id="dialog-book-tags"
            v-model="form.tags"
            name="tags"
            type="text"
            maxlength="3200"
            autocomplete="off"
            :aria-invalid="Boolean(fieldErrors.tags)"
            aria-describedby="dialog-tags-help dialog-book-tags-error"
            class="fluid-control"
            :class="{ 'is-invalid': Boolean(fieldErrors.tags) }"
          />
          <small id="dialog-tags-help">カンマ区切り</small>
          <small v-if="fieldErrors.tags" id="dialog-book-tags-error">
            {{ fieldErrors.tags }}
          </small>
        </label>
        <label class="field" for="dialog-book-notes">
          <span>メモ</span>
          <ElInput
            id="dialog-book-notes"
            v-model="form.notes"
            name="notes"
            type="textarea"
            :rows="5"
            maxlength="10000"
            autocomplete="off"
            :aria-invalid="Boolean(fieldErrors.notes)"
            aria-describedby="dialog-book-notes-error"
            class="fluid-control"
            :class="{ 'is-invalid': Boolean(fieldErrors.notes) }"
          />
          <small v-if="fieldErrors.notes" id="dialog-book-notes-error">
            {{ fieldErrors.notes }}
          </small>
        </label>
      </fieldset>

      <ElAlert
        v-if="statusMessage || formError"
        :type="formError ? 'error' : 'success'"
        :closable="false"
        show-icon
        aria-live="polite"
      >
        {{ formError || statusMessage }}
      </ElAlert>
    </form>

    <template #footer>
      <ElButton
        native-type="button"
        type="info"
        text
        :disabled="saving"
        @click="updateVisibility(false)"
      >
        閉じる
      </ElButton>
      <ElButton
        :icon="ElIconCheck"
        native-type="submit"
        form="book-metadata-dialog-form"
        :loading="saving"
        :disabled="loading || Boolean(loadError) || !detail"
      >
        変更を保存
      </ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-block-size: 12rem;
}

.spinner {
  inline-size: 2.25rem;
  block-size: 2.25rem;
}

.form {
  display: grid;
  gap: 1rem;
}

.source-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  margin: 0;
  border-radius: 0.65rem;
  background: var(--bc-paper-deep);
}

.source-details div {
  display: grid;
  gap: 0.15rem;
}

.source-details .path {
  grid-column: 1 / -1;
}

.source-details dt {
  color: var(--bc-ink-soft);
  font-size: 0.78rem;
  font-weight: 700;
}

.source-details dd {
  min-inline-size: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.error-summary {
  padding: 0.75rem 1rem;
  border-inline-start: 0.3rem solid var(--danger);
  color: var(--danger);
  background: color-mix(in oklab, var(--danger) 8%, var(--bc-panel));
}

.error-summary:focus {
  outline: 2px solid var(--danger);
  outline-offset: 2px;
}

.error-summary ul {
  margin-block: 0.5rem 0;
}

.error-summary a {
  color: inherit;
}

.group {
  display: grid;
  gap: 1rem;
  min-inline-size: 0;
  padding: 1rem;
  border: 1px solid var(--bc-line-soft);
  border-radius: 0.65rem;
}

.group legend {
  padding-inline: 0.35rem;
  font-weight: 700;
}

.field {
  display: grid;
  gap: 0.35rem;
  min-inline-size: 0;
}

.field > span {
  font-weight: 700;
}

.field small {
  color: var(--bc-ink-soft);
}

.field small[id$="-error"],
#dialog-reading-status-error {
  color: var(--danger);
}

.split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.choice {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-block-size: 2.75rem;
  padding-inline: 0.75rem;
  border: 1px solid var(--bc-line-soft);
  border-radius: 0.6rem;
  cursor: pointer;
}

@media (width <= 36rem) {
  .source-details,
  .split {
    grid-template-columns: minmax(0, 1fr);
  }

  .source-details .path {
    grid-column: auto;
  }
}
</style>
