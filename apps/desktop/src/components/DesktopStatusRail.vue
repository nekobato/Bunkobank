<script setup lang="ts">
/** Server lifecycle monitor and essential native controls. */

import { getShelfmarkToneMeta } from "@bunkobank/ui";
import {
  FolderOpened,
  Refresh,
  TopRight,
  VideoPause,
  VideoPlay
} from "@element-plus/icons-vue";
import { ElAlert, ElButton, ElTag } from "element-plus";
import { computed } from "vue";

import type { DesktopManagerState } from "../manager.js";
import type { ServerPresentation } from "../presentation.js";

const {
  state,
  endpoint,
  presentation,
  processMessage = "",
  errorMessage = ""
} = defineProps<{
  state: DesktopManagerState;
  endpoint: string;
  presentation: ServerPresentation;
  processMessage?: string;
  errorMessage?: string;
}>();

defineEmits<{
  start: [];
  stop: [];
  open: [];
  openLogs: [];
  refresh: [];
}>();

const statusMeta = computed(() => getShelfmarkToneMeta(presentation.tone));
const isBusy = computed(() =>
  ["checking", "starting", "stopping"].includes(state.server.phase)
);
const webGuidance = computed(() => {
  switch (state.server.phase) {
    case "running":
      return "アプリ内でライブラリを管理できます。";
    case "checking":
      return "サーバー状態を確認しています。完了までお待ちください。";
    case "starting":
      return "サーバーを起動しています。稼働するとBunkobankを開けます。";
    case "stopping":
      return "サーバーを停止しています。完了までお待ちください。";
    default:
      return "Bunkobankを開くには、まずサーバーを起動してください。";
  }
});
</script>

<template>
  <main
    id="server-monitor"
    class="server-monitor"
    aria-labelledby="product-name"
    tabindex="-1"
  >
    <header class="brand">
      <span class="brand-mark" aria-hidden="true">BB</span>
      <div>
        <h1 id="product-name" class="brand-name">Bunkobank</h1>
        <p class="product-kind">Desktop</p>
      </div>
    </header>

    <section
      class="server-status status-spine"
      :class="statusMeta.className"
      aria-live="polite"
    >
      <div class="status-heading">
        <h2 id="server-state" class="server-heading">サーバー</h2>
        <ElTag :type="statusMeta.type" round>
          {{ presentation.label }}
        </ElTag>
      </div>
      <p v-if="presentation.detail" class="server-detail">
        {{ presentation.detail }}
      </p>
      <code class="endpoint">{{ endpoint }}</code>
    </section>

    <ElAlert v-if="errorMessage" type="error" :closable="false" show-icon>
      {{ errorMessage }}
    </ElAlert>

    <div class="app-action">
      <ElButton
        class="app-button type-primary fluid-control"
        :icon="TopRight"
        :disabled="state.server.phase !== 'running'"
        @click="$emit('open')"
      >
        Bunkobankを開く
      </ElButton>
      <p class="web-guidance">{{ webGuidance }}</p>
    </div>

    <div class="monitor-actions" aria-label="サーバー操作">
      <ElButton
        v-if="state.server.phase !== 'running'"
        class="monitor-button type-secondary fluid-control"
        :icon="VideoPlay"
        plain
        :loading="state.server.phase === 'starting'"
        :disabled="!state.server.canStart || isBusy"
        @click="$emit('start')"
      >
        起動
      </ElButton>
      <ElButton
        v-if="state.server.canStop"
        class="monitor-button type-danger fluid-control"
        :icon="VideoPause"
        type="danger"
        plain
        :loading="state.server.phase === 'stopping'"
        :disabled="!state.server.canStop || isBusy"
        @click="$emit('stop')"
      >
        停止
      </ElButton>
      <ElButton
        class="monitor-button type-quiet fluid-control"
        :icon="Refresh"
        text
        :loading="state.server.phase === 'checking'"
        :disabled="isBusy"
        @click="$emit('refresh')"
      >
        状態を再確認
      </ElButton>
    </div>

    <details class="diagnostics">
      <summary>診断情報</summary>
      <div class="diagnostic-content">
        <div class="config-path">
          <span>設定ファイル</span>
          <code>{{ state.environment?.configPath ?? "確認中…" }}</code>
        </div>
        <div class="config-path">
          <span>ログフォルダー</span>
          <code>{{ state.environment?.logDir ?? "確認中…" }}</code>
        </div>
        <ElButton
          :icon="FolderOpened"
          size="small"
          plain
          :disabled="!state.environment"
          @click="$emit('openLogs')"
        >
          ログフォルダーを開く
        </ElButton>
        <p v-if="processMessage" class="process-message">
          {{ processMessage }}
        </p>
      </div>
    </details>
  </main>
</template>

<style scoped>
.server-monitor {
  box-sizing: border-box;
  display: grid;
  align-content: start;
  inline-size: min(100%, 34rem);
  min-block-size: 100dvh;
  margin-inline: auto;
  background: var(--bc-deep-shelf);
  color: #f7f9f8;
  padding: clamp(1.5rem, 7vw, 3rem);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.brand-mark {
  display: grid;
  place-items: center;
  inline-size: 2.75rem;
  block-size: 3.3rem;
  border-radius: 0.3rem 0.8rem 0.8rem 0.3rem;
  background: #d9ddff;
  color: var(--bc-deep-shelf);
  font-family: var(--bc-font-display);
  font-size: 0.78rem;
  font-weight: 850;
  letter-spacing: 0.05em;
  box-shadow: inset 0.3rem 0 rgb(49 89 168 / 24%);
}

.brand-name,
.product-kind,
.server-heading,
.server-detail,
.process-message {
  margin: 0;
}

.brand-name {
  font-family: var(--bc-font-display);
  font-size: 1.2rem;
  font-weight: 800;
  letter-spacing: -0.025em;
}

.product-kind {
  margin-block-start: 0.15rem;
  color: rgb(247 249 248 / 58%);
  font-family: var(--bc-font-data);
  font-size: 0.68rem;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.server-status {
  margin-block: clamp(2.2rem, 7vh, 3.75rem) 1.25rem;
  padding-inline-start: 1.25rem;
}

.status-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.server-heading {
  color: rgb(247 249 248 / 58%);
  font-family: var(--bc-font-data);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.server-detail {
  margin-block-start: 0.9rem;
  color: rgb(247 249 248 / 72%);
  font-size: 0.86rem;
  text-wrap: pretty;
}

.endpoint,
.config-path code {
  display: block;
  overflow-wrap: anywhere;
  font-family: var(--bc-font-data);
}

.endpoint {
  margin-block-start: 1rem;
  color: rgb(247 249 248 / 84%);
  font-size: 0.72rem;
}

.app-action {
  display: grid;
  gap: 0.65rem;
}

.web-guidance {
  margin: 0;
  color: rgb(247 249 248 / 68%);
  font-size: 0.78rem;
  line-height: 1.6;
  text-wrap: pretty;
}

.process-message {
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 0.55rem;
  background: rgb(255 255 255 / 7%);
  padding: 0.7rem;
  color: rgb(247 249 248 / 72%);
  font-family: var(--bc-font-data);
  font-size: 0.67rem;
  overflow-wrap: anywhere;
}

.monitor-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin-block-start: 1rem;
}

.app-action :deep(.app-button),
.monitor-actions :deep(.monitor-button) {
  min-block-size: 3.15rem;
  border-width: 1px;
  font-weight: 750;
  box-shadow: none;
}

.app-action :deep(.app-button.type-primary:not(:disabled)) {
  border-color: #d9ddff;
  background: #d9ddff;
  color: var(--bc-deep-shelf);
}

.app-action :deep(.app-button.type-primary:not(:disabled):hover) {
  border-color: #eef0ff;
  background: #eef0ff;
}

.monitor-actions :deep(.monitor-button.type-secondary:not(:disabled)) {
  border-color: #86b8ae;
  background: transparent;
  color: #edf4f2;
}

.monitor-actions :deep(.monitor-button.type-secondary:not(:disabled):hover) {
  background: rgb(134 184 174 / 14%);
}

.monitor-actions :deep(.monitor-button.type-danger:not(:disabled)) {
  border-color: #ff9182;
  background: transparent;
  color: #ffb4a8;
}

.monitor-actions :deep(.monitor-button.type-danger:not(:disabled):hover) {
  background: rgb(255 145 130 / 12%);
}

.monitor-actions :deep(.monitor-button.type-quiet:not(:disabled)) {
  border-color: transparent;
  background: transparent;
  color: #cbd9d6;
}

.monitor-actions :deep(.monitor-button.type-quiet:not(:disabled):hover) {
  background: rgb(203 217 214 / 10%);
  color: #edf4f2;
}

.app-action :deep(.app-button:disabled),
.monitor-actions :deep(.monitor-button:disabled) {
  border-color: #718784;
  background: rgb(255 255 255 / 4%);
  color: #a9bbb7;
}

.diagnostics {
  margin-block-start: 2rem;
  color: rgb(247 249 248 / 50%);
  font-size: 0.68rem;
}

.diagnostics summary {
  inline-size: fit-content;
  cursor: pointer;
}

.diagnostic-content {
  display: grid;
  gap: 0.85rem;
  margin-block-start: 0.85rem;
}

.config-path code {
  margin-block-start: 0.28rem;
  color: inherit;
}

@media (forced-colors: active) {
  .brand-mark {
    border: 1px solid CanvasText;
    box-shadow: none;
  }

  .monitor-actions :deep(.monitor-button) {
    border-color: ButtonBorder;
    color: ButtonText;
  }

  .app-action :deep(.app-button) {
    border-color: ButtonBorder;
    color: ButtonText;
  }
}
</style>
