<script setup lang="ts">
/** PrimeVue control surface for the distraction-free book reader. */

import type { PageLayout, ReadingDirection } from "@bookcafe/core";

type ReaderMode = "paged" | "vertical";
type ReaderFit = "contain" | "width" | "height" | "actual";

const {
  title,
  pageLabel,
  pageProgress,
  pageProgressLabel,
  pageInputId,
  pageCount,
  zoomLabel,
  disabled = false
} = defineProps<{
  title: string;
  pageLabel: string;
  pageProgress: number;
  pageProgressLabel: string;
  pageInputId: string;
  pageCount: number;
  zoomLabel: string;
  disabled?: boolean;
}>();

const pageInput = defineModel<string>("pageInput", { required: true });
const direction = defineModel<ReadingDirection>("direction", {
  required: true
});
const mode = defineModel<ReaderMode>("mode", { required: true });
const layout = defineModel<PageLayout>("layout", { required: true });
const fit = defineModel<ReaderFit>("fit", { required: true });

defineEmits<{
  previous: [];
  next: [];
  commitPage: [];
  zoomOut: [];
  zoomIn: [];
  resetZoom: [];
}>();

const settingsPopover = useTemplateRef<{
  toggle: (event: Event) => void;
}>("settings-popover");

const toggleSettings = (event: Event): void => {
  settingsPopover.value?.toggle(event);
};

const directionOptions = [
  { label: "右から左", value: "rtl" },
  { label: "左から右", value: "ltr" }
] satisfies Array<{ label: string; value: ReadingDirection }>;
const modeOptions = [
  { label: "ページ送り", value: "paged" },
  { label: "縦スクロール", value: "vertical" }
] satisfies Array<{ label: string; value: ReaderMode }>;
const layoutOptions = [
  { label: "1ページ", value: "single" },
  { label: "見開き", value: "spread" }
] satisfies Array<{ label: string; value: PageLayout }>;
const fitOptions = [
  { label: "全体表示", value: "contain" },
  { label: "幅に合わせる", value: "width" },
  { label: "高さに合わせる", value: "height" },
  { label: "原寸", value: "actual" }
] satisfies Array<{ label: string; value: ReaderFit }>;
</script>

<template>
  <header class="reader-toolbar">
    <div class="book-status">
      <div class="book-title">
        <Button
          as="router-link"
          to="/"
          icon="pi pi-arrow-left"
          severity="secondary"
          variant="text"
          size="small"
          aria-label="ライブラリへ戻る"
          title="ライブラリへ戻る"
        />
        <strong>{{ title }}</strong>
      </div>
      <span>{{ pageLabel }}</span>
      <ProgressBar
        class="reader-progress"
        :value="pageProgress"
        :show-value="false"
        :aria-label="`読書の進捗 ${pageProgressLabel}`"
      />
      <span class="progress-label">{{ pageProgressLabel }}</span>
    </div>

    <div class="controls" role="toolbar" aria-label="リーダー操作">
      <div class="button-group" role="group" aria-label="ページ送り">
        <Button
          icon="pi pi-chevron-left"
          severity="secondary"
          variant="text"
          aria-label="前のページ"
          :disabled="disabled"
          @click="$emit('previous')"
        />
        <Button
          icon="pi pi-chevron-right"
          severity="secondary"
          variant="text"
          aria-label="次のページ"
          :disabled="disabled"
          @click="$emit('next')"
        />
      </div>

      <form
        class="jump"
        aria-label="ページ移動"
        @submit.prevent="$emit('commitPage')"
      >
        <label :for="pageInputId">ページ</label>
        <InputText
          :id="pageInputId"
          v-model="pageInput"
          name="page"
          type="number"
          autocomplete="off"
          inputmode="numeric"
          min="1"
          :max="pageCount"
          step="1"
          required
          :disabled="disabled"
        />
        <span>/ {{ pageCount }}</span>
        <Button label="移動" size="small" type="submit" :disabled="disabled" />
      </form>

      <Button
        label="設定"
        icon="pi pi-cog"
        severity="secondary"
        variant="outlined"
        aria-haspopup="dialog"
        :disabled="disabled"
        @click="toggleSettings"
      />

      <Popover
        ref="settings-popover"
        class="reader-settings-popover"
        aria-label="リーダー設定"
      >
        <div class="reader-settings">
          <div class="setting-field">
            <span id="reader-zoom-label" class="setting-label">拡大率</span>
            <div
              class="button-group zoom"
              role="group"
              aria-labelledby="reader-zoom-label"
            >
              <Button
                icon="pi pi-minus"
                severity="secondary"
                variant="text"
                aria-label="縮小"
                :disabled="disabled"
                @click="$emit('zoomOut')"
              />
              <output aria-live="polite">{{ zoomLabel }}</output>
              <Button
                icon="pi pi-plus"
                severity="secondary"
                variant="text"
                aria-label="拡大"
                :disabled="disabled"
                @click="$emit('zoomIn')"
              />
              <Button
                label="100%に戻す"
                size="small"
                severity="secondary"
                variant="text"
                :disabled="disabled"
                @click="$emit('resetZoom')"
              />
            </div>
          </div>

          <div class="setting-field">
            <label class="setting-label" for="reader-direction">読む方向</label>
            <Select
              v-model="direction"
              input-id="reader-direction"
              :options="directionOptions"
              option-label="label"
              option-value="value"
              size="small"
              :disabled="disabled"
            />
          </div>

          <div class="setting-field">
            <label class="setting-label" for="reader-mode">表示方法</label>
            <Select
              v-model="mode"
              input-id="reader-mode"
              :options="modeOptions"
              option-label="label"
              option-value="value"
              size="small"
              :disabled="disabled"
            />
          </div>

          <div v-if="mode === 'paged'" class="setting-field">
            <label class="setting-label" for="reader-layout">
              ページレイアウト
            </label>
            <Select
              v-model="layout"
              input-id="reader-layout"
              :options="layoutOptions"
              option-label="label"
              option-value="value"
              size="small"
              :disabled="disabled"
            />
          </div>

          <div class="setting-field">
            <label class="setting-label" for="reader-fit">画像の表示倍率</label>
            <Select
              v-model="fit"
              input-id="reader-fit"
              :options="fitOptions"
              option-label="label"
              option-value="value"
              size="small"
              :disabled="disabled"
            />
          </div>
        </div>
      </Popover>
    </div>
  </header>
</template>

<style scoped>
.reader-toolbar {
  display: grid;
  grid-template-columns: minmax(10rem, 0.7fr) minmax(0, 1.3fr);
  align-items: center;
  gap: 1rem;
  border-block-end: 1px solid rgb(255 255 255 / 12%);
  background: color-mix(in oklab, var(--reader-panel) 94%, transparent);
  padding: 0.7rem max(1rem, env(safe-area-inset-right)) 0.7rem
    max(1rem, env(safe-area-inset-left));
  color: var(--reader-text);
  backdrop-filter: blur(12px);
}

.book-status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.25rem 0.65rem;
  min-inline-size: 0;
}

.book-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-inline-size: 0;
}

.book-title :deep(.p-button) {
  flex: 0 0 auto;
}

.book-status strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-status span {
  color: rgb(243 246 245 / 68%);
  font-family: var(--bc-font-data);
  font-size: 0.7rem;
}

.reader-progress {
  block-size: 0.25rem;
}

.progress-label {
  text-align: end;
}

.controls,
.button-group,
.jump {
  display: flex;
  align-items: center;
}

.controls {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.button-group {
  gap: 0.1rem;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 0.6rem;
}

.jump {
  gap: 0.4rem;
  color: rgb(243 246 245 / 68%);
  font-size: 0.72rem;
}

.jump :deep(.p-inputtext) {
  inline-size: 4rem;
}

.zoom output {
  min-inline-size: 3.5rem;
  color: rgb(243 246 245 / 78%);
  font-family: var(--bc-font-data);
  font-size: 0.8rem;
  text-align: center;
}

.reader-toolbar :deep(.p-button.p-button-text) {
  color: var(--reader-text);
}

.reader-toolbar :deep(.p-inputtext) {
  border-color: rgb(255 255 255 / 16%);
  background: #26363c;
  color: var(--reader-text);
}

.reader-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(9rem, 1fr));
  gap: 1rem;
  inline-size: min(25rem, calc(100vw - 2rem));
}

.setting-field {
  display: grid;
  align-content: start;
  gap: 0.4rem;
}

.setting-field:first-child {
  grid-column: 1 / -1;
}

.reader-settings .button-group {
  border-color: var(--p-content-border-color);
}

.reader-settings .zoom output {
  color: var(--p-text-muted-color);
}

.setting-label {
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  font-weight: 600;
}

.setting-field :deep(.p-select) {
  inline-size: 100%;
}

@media (width <= 68rem) {
  .reader-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .controls {
    justify-content: flex-start;
  }
}

@media (width <= 40rem) {
  .jump label,
  .jump > span {
    display: none;
  }

  .reader-settings {
    grid-template-columns: minmax(0, 1fr);
  }

  .setting-field:first-child {
    grid-column: auto;
  }
}
</style>
