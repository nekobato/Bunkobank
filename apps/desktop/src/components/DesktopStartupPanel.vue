<script setup lang="ts">
/** Login-startup preference panel for the Desktop Manager. */

import { getShelfmarkToneMeta } from "@bunkobank/ui";
import { ElAlert, ElCard, ElSwitch, ElTag } from "element-plus";
import { computed } from "vue";

import type { DesktopManagerState } from "../manager.js";
import { getStartupPresentation } from "../presentation.js";

const { state } = defineProps<{ state: DesktopManagerState }>();

defineEmits<{ change: [enabled: boolean] }>();

const presentation = computed(() =>
  getStartupPresentation(state.startup.phase)
);
const statusMeta = computed(() =>
  getShelfmarkToneMeta(presentation.value.tone)
);
const title = computed(() =>
  state.environment?.platform === "macos"
    ? "ログイン時にBunkobankサーバーを起動"
    : "ログイン時にBunkobankを起動"
);
const canChange = computed(() =>
  ["disabled", "enabled", "outdated"].includes(state.startup.phase)
);
</script>

<template>
  <ElCard class="startup-card status-spine" :class="statusMeta.className">
    <template #header>
      <div class="card-heading">
        <h2 id="startup-title">自動起動</h2>
        <ElTag :type="statusMeta.type" round>
          {{ presentation.label }}
        </ElTag>
      </div>
    </template>
    <template #default>
      <div
        class="preference-row"
        :aria-busy="state.startup.phase === 'updating'"
      >
        <div>
          <label id="startup-toggle-label" for="startup-toggle">
            {{ title }}
          </label>
        </div>
        <ElSwitch
          id="startup-toggle"
          :model-value="state.startup.enabled"
          :disabled="!canChange"
          aria-labelledby="startup-toggle-label"
          @update:model-value="$emit('change', Boolean($event))"
        />
      </div>
      <ElAlert
        v-if="state.startup.phase === 'unsupported'"
        type="info"
        :closable="false"
        show-icon
      >
        この環境の自動起動はDesktop Managerから管理できません。
      </ElAlert>
      <ElAlert
        v-else-if="state.startup.phase === 'outdated'"
        type="warning"
        :closable="false"
        show-icon
      >
        起動設定が古くなっています。スイッチを入れ直すと現在の設定へ更新します。
      </ElAlert>
    </template>
  </ElCard>
</template>

<style scoped>
.startup-card {
  overflow: hidden;
  border: 1px solid var(--bc-line-soft);
  box-shadow: var(--bc-shadow-low);
}

.card-heading,
.preference-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.card-heading {
  align-items: start;
}

.card-heading h2 {
  margin: 0;
}

.card-heading h2 {
  font-family: var(--bc-font-display);
  font-size: clamp(1.2rem, 2vw, 1.6rem);
  line-height: 1.2;
  letter-spacing: -0.03em;
  text-wrap: balance;
}

.preference-row {
  min-block-size: 4.5rem;
  border: 1px solid var(--bc-line-soft);
  border-radius: 0.75rem;
  background: var(--bc-paper);
  padding: 0.9rem 1rem;
}

.preference-row label {
  font-size: 0.88rem;
  font-weight: 750;
}

.el-alert {
  margin-block-start: 0.85rem;
}

@media (width < 34rem) {
  .preference-row {
    align-items: start;
  }
}
</style>
