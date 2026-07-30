<script setup lang="ts">
/** Server lifecycle monitor and essential native controls. */

import { getShelfmarkToneMeta } from "@bookcafe/ui";
import Button from "primevue/button";
import Message from "primevue/message";
import Tag from "primevue/tag";
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
const webGuidance =
  "アカウント、ライブラリ、ネットワーク、サムネイルの設定はWeb UIで行います。";
</script>

<template>
  <main
    id="server-monitor"
    class="server-monitor"
    aria-labelledby="product-name"
    tabindex="-1"
  >
    <header class="brand">
      <span class="brand-mark" aria-hidden="true">BC</span>
      <div>
        <h1 id="product-name" class="brand-name">BookCafe</h1>
        <p class="product-kind">Server Monitor</p>
      </div>
    </header>

    <section
      class="server-status status-spine"
      :class="statusMeta.className"
      aria-live="polite"
    >
      <div class="status-heading">
        <h2 id="server-state" class="server-heading">サーバー</h2>
        <Tag
          :value="presentation.label"
          :severity="statusMeta.severity"
          rounded
        />
      </div>
      <p v-if="presentation.detail" class="server-detail">
        {{ presentation.detail }}
      </p>
      <code class="endpoint">{{ endpoint }}</code>
    </section>

    <Message v-if="errorMessage" severity="error" :closable="false">
      {{ errorMessage }}
    </Message>

    <p class="web-guidance">{{ webGuidance }}</p>

    <div class="monitor-actions" aria-label="サーバー操作">
      <Button
        label="Web UIを開く"
        icon="pi pi-external-link"
        :disabled="state.server.phase !== 'running'"
        fluid
        @click="$emit('open')"
      />
      <Button
        label="起動"
        icon="pi pi-play"
        severity="secondary"
        variant="outlined"
        :loading="state.server.phase === 'starting'"
        :disabled="!state.server.canStart || isBusy"
        fluid
        @click="$emit('start')"
      />
      <Button
        label="停止"
        icon="pi pi-stop-circle"
        severity="danger"
        variant="outlined"
        :loading="state.server.phase === 'stopping'"
        :disabled="!state.server.canStop || isBusy"
        fluid
        @click="$emit('stop')"
      />
      <Button
        label="状態を再確認"
        icon="pi pi-refresh"
        severity="secondary"
        variant="text"
        :loading="state.server.phase === 'checking'"
        :disabled="isBusy"
        fluid
        @click="$emit('refresh')"
      />
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
        <Button
          label="ログフォルダーを開く"
          icon="pi pi-folder-open"
          size="small"
          severity="secondary"
          variant="outlined"
          :disabled="!state.environment"
          @click="$emit('openLogs')"
        />
        <p v-if="processMessage" class="process-message">
          {{ processMessage }}
        </p>
      </div>
    </details>
  </main>
</template>

<style scoped>
.server-monitor {
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
.web-guidance,
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
  margin-block: clamp(2.5rem, 8vh, 4.5rem) 1.5rem;
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

.web-guidance {
  margin-block: 1.5rem;
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
  gap: 0.65rem;
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
}
</style>
