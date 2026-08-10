<script setup lang="ts">
/** Editable server port controls for the Desktop Manager. */

import { getShelfmarkToneMeta } from "@bunkobank/ui";
import { Check } from "@element-plus/icons-vue";
import { ElAlert, ElButton, ElCard, ElInputNumber, ElTag } from "element-plus";
import { computed } from "vue";

import type { DesktopManagerState } from "../manager.js";
import { localizeDesktopFieldError } from "../presentation.js";

const { state } = defineProps<{
  state: DesktopManagerState;
}>();
const emit = defineEmits<{
  save: [];
  "update-port": [port: number | null];
}>();
const canEdit = computed(
  () =>
    state.phase === "ready" &&
    !["checking", "running", "starting", "stopping"].includes(
      state.server.phase
    )
);
const phaseMeta = computed(() =>
  getShelfmarkToneMeta(
    state.network.phase === "saved"
      ? "success"
      : state.network.phase === "error"
        ? "danger"
        : state.network.phase === "saving"
          ? "info"
          : "neutral"
  )
);
const phaseLabel = computed(() => {
  if (state.network.phase === "saving") {
    return "保存中";
  }

  if (state.network.phase === "saved") {
    return "保存済み";
  }

  if (state.network.phase === "error") {
    return "要確認";
  }

  return "変更可能";
});
const portError = computed(() =>
  localizeDesktopFieldError("port", state.network.fieldErrors.port)
);
</script>

<template>
  <ElCard class="network-card status-spine" :class="phaseMeta.className">
    <template #header>
      <div class="card-heading">
        <h2>ネットワーク</h2>
        <ElTag :type="phaseMeta.type" round>{{ phaseLabel }}</ElTag>
      </div>
    </template>
    <template #default>
      <form class="network-form" novalidate @submit.prevent="emit('save')">
        <div class="field">
          <label for="desktop-server-port">ポート</label>
          <ElInputNumber
            id="desktop-server-port"
            class="fluid-control"
            name="port"
            :model-value="state.network.portDraft"
            :min="1"
            :max="65535"
            :controls="false"
            :disabled="!canEdit"
            :class="{
              'is-invalid': Boolean(state.network.fieldErrors.port)
            }"
            :aria-invalid="Boolean(state.network.fieldErrors.port)"
            aria-describedby="desktop-server-port-help desktop-server-port-error"
            @update:model-value="emit('update-port', $event ?? null)"
          />
          <small id="desktop-server-port-help">
            サーバー停止中に変更できます。
          </small>
          <small
            v-if="portError"
            id="desktop-server-port-error"
            class="field-error"
          >
            {{ portError }}
          </small>
        </div>
        <ElButton
          :icon="Check"
          native-type="submit"
          :loading="state.network.phase === 'saving'"
          :disabled="!canEdit"
        >
          ポートを保存
        </ElButton>
        <ElAlert
          v-if="state.network.phase === 'saved'"
          type="success"
          :closable="false"
          show-icon
        >
          保存しました。次回のサーバー起動から使用します。
        </ElAlert>
      </form>
    </template>
  </ElCard>
</template>

<style scoped>
.network-card {
  border-inline-start-width: 0.4rem;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.card-heading h2 {
  margin: 0;
}

.network-form,
.field {
  display: grid;
  gap: 0.75rem;
}

.field label {
  color: var(--bc-ink-soft);
  font-size: 0.8rem;
  font-weight: 700;
}

.field small {
  color: var(--bc-ink-soft);
  font-size: 0.72rem;
}

.field .field-error {
  color: var(--bc-danger);
}
</style>
