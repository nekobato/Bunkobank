<script setup lang="ts">
/** Server lifecycle and primary controls for Desktop Manager. */

import { getShelfmarkToneMeta } from "@bookcafe/ui";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { computed } from "vue";

import type { DesktopManagerState } from "../manager.js";
import type { ServerPresentation } from "../presentation.js";

const {
  state,
  endpoint,
  presentation,
  processMessage = ""
} = defineProps<{
  state: DesktopManagerState;
  endpoint: string;
  presentation: ServerPresentation;
  processMessage?: string;
}>();

defineEmits<{
  start: [];
  stop: [];
  open: [];
  refresh: [];
}>();

const statusMeta = computed(() => getShelfmarkToneMeta(presentation.tone));
const isBusy = computed(() =>
  ["checking", "starting", "stopping"].includes(state.server.phase)
);
</script>

<template>
  <aside class="status-rail" aria-labelledby="server-state">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">BC</span>
      <div>
        <p class="brand-name">BookCafe</p>
      </div>
    </div>

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
      <p v-if="processMessage" class="process-message">
        {{ processMessage }}
      </p>
    </section>

    <div class="rail-actions" aria-label="サーバー操作">
      <Button
        label="起動"
        icon="pi pi-play"
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
        label="ライブラリを開く"
        icon="pi pi-external-link"
        severity="secondary"
        :disabled="state.server.phase !== 'running'"
        fluid
        @click="$emit('open')"
      />
      <Button
        label="再確認"
        icon="pi pi-refresh"
        severity="secondary"
        variant="text"
        :loading="state.server.phase === 'checking'"
        :disabled="isBusy"
        fluid
        @click="$emit('refresh')"
      />
    </div>

    <div class="config-path">
      <span>設定ファイル</span>
      <code>{{ state.environment?.configPath ?? "確認中…" }}</code>
    </div>
  </aside>
</template>

<style scoped>
.status-rail {
  position: sticky;
  inset-block-start: 0;
  display: flex;
  flex-direction: column;
  min-block-size: 100dvh;
  max-block-size: 100dvh;
  overflow-y: auto;
  border-inline-end: 1px solid rgb(255 255 255 / 14%);
  background: var(--bc-deep-shelf);
  color: #f7f9f8;
  padding: clamp(1.25rem, 2.8vw, 2.25rem);
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

.server-status {
  margin-block: clamp(2.5rem, 7vh, 4.5rem) 2rem;
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

.process-message {
  margin-block-start: 1rem;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 0.55rem;
  background: rgb(255 255 255 / 7%);
  padding: 0.7rem;
  color: rgb(247 249 248 / 72%);
  font-family: var(--bc-font-data);
  font-size: 0.67rem;
  overflow-wrap: anywhere;
}

.rail-actions {
  display: grid;
  gap: 0.65rem;
  margin-block-start: auto;
}

.config-path {
  margin-block-start: 1.5rem;
  color: rgb(247 249 248 / 50%);
  font-size: 0.68rem;
}

.config-path code {
  margin-block-start: 0.28rem;
  color: inherit;
}

@media (forced-colors: active) {
  .status-rail {
    border-inline-end-color: CanvasText;
  }

  .brand-mark {
    border: 1px solid CanvasText;
    box-shadow: none;
  }
}
</style>
