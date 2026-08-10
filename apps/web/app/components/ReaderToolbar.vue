<script setup lang="ts">
/** Element Plus control surface for the distraction-free book reader. */

import type { PageLayout, ReadingDirection } from "@bunkobank/core";

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
        <NuxtLink
          class="back-link"
          to="/"
          aria-label="ライブラリへ戻る"
          title="ライブラリへ戻る"
        >
          <ElIcon aria-hidden="true"><ElIconBack /></ElIcon>
        </NuxtLink>
        <strong>{{ title }}</strong>
      </div>
      <span>{{ pageLabel }}</span>
      <ElProgress
        class="reader-progress"
        :percentage="pageProgress"
        :show-text="false"
        :aria-label="`読書の進捗 ${pageProgressLabel}`"
      />
      <span class="progress-label">{{ pageProgressLabel }}</span>
    </div>

    <div class="controls" role="toolbar" aria-label="リーダー操作">
      <div class="button-group" role="group" aria-label="ページ送り">
        <ElButton
          :icon="ElIconArrowLeft"
          type="info"
          text
          aria-label="前のページ"
          :disabled="disabled"
          @click="$emit('previous')"
        />
        <ElButton
          :icon="ElIconArrowRight"
          type="info"
          text
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
        <ElInput
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
        <ElButton size="small" native-type="submit" :disabled="disabled">
          移動
        </ElButton>
      </form>

      <ElPopover
        trigger="click"
        placement="bottom-end"
        width="min(25rem, calc(100vw - 2rem))"
        :fallback-placements="['top-end', 'bottom-start', 'top-start']"
        popper-class="reader-settings-popover"
        aria-label="リーダー設定"
      >
        <template #reference>
          <ElButton
            :icon="ElIconSetting"
            type="info"
            plain
            aria-haspopup="true"
            :disabled="disabled"
          >
            設定
          </ElButton>
        </template>
        <div class="reader-settings">
          <div class="setting-field">
            <span id="reader-zoom-label" class="setting-label">拡大率</span>
            <div
              class="button-group zoom"
              role="group"
              aria-labelledby="reader-zoom-label"
            >
              <ElButton
                :icon="ElIconMinus"
                type="info"
                text
                aria-label="縮小"
                :disabled="disabled"
                @click="$emit('zoomOut')"
              />
              <output aria-live="polite">{{ zoomLabel }}</output>
              <ElButton
                :icon="ElIconPlus"
                type="info"
                text
                aria-label="拡大"
                :disabled="disabled"
                @click="$emit('zoomIn')"
              />
              <ElButton
                size="small"
                type="info"
                text
                :disabled="disabled"
                @click="$emit('resetZoom')"
              >
                100%に戻す
              </ElButton>
            </div>
          </div>

          <div class="setting-field">
            <label class="setting-label" for="reader-direction">読む方向</label>
            <ElSelect
              id="reader-direction"
              v-model="direction"
              size="small"
              :disabled="disabled"
            >
              <ElOption
                v-for="option in directionOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </div>

          <div class="setting-field">
            <label class="setting-label" for="reader-mode">表示方法</label>
            <ElSelect
              id="reader-mode"
              v-model="mode"
              size="small"
              :disabled="disabled"
            >
              <ElOption
                v-for="option in modeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </div>

          <div v-if="mode === 'paged'" class="setting-field">
            <label class="setting-label" for="reader-layout">
              ページレイアウト
            </label>
            <ElSelect
              id="reader-layout"
              v-model="layout"
              size="small"
              :disabled="disabled"
            >
              <ElOption
                v-for="option in layoutOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </div>

          <div class="setting-field">
            <label class="setting-label" for="reader-fit">画像の表示倍率</label>
            <ElSelect
              id="reader-fit"
              v-model="fit"
              size="small"
              :disabled="disabled"
            >
              <ElOption
                v-for="option in fitOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </div>
        </div>
      </ElPopover>
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

.back-link {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  min-inline-size: 2rem;
  min-block-size: 2rem;
  border-radius: var(--el-border-radius-base);
  color: var(--reader-text);
  text-decoration: none;
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

.jump :deep(.el-input) {
  inline-size: 4rem;
}

.zoom output {
  min-inline-size: 3.5rem;
  color: rgb(243 246 245 / 78%);
  font-family: var(--bc-font-data);
  font-size: 0.8rem;
  text-align: center;
}

.reader-toolbar :deep(.el-button.is-text) {
  color: var(--reader-text);
}

.reader-toolbar :deep(.el-input__wrapper) {
  border-color: rgb(255 255 255 / 16%);
  background: #26363c;
}

.reader-toolbar :deep(.el-input__inner) {
  color: var(--reader-text);
}

.reader-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(9rem, 1fr));
  gap: 1rem;
  min-inline-size: 0;
  inline-size: 100%;
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
  border-color: var(--el-border-color);
}

.reader-settings .zoom output {
  color: var(--el-text-color-secondary);
}

.setting-label {
  color: var(--el-text-color-secondary);
  font-size: 0.8rem;
  font-weight: 600;
}

.setting-field :deep(.el-select) {
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
