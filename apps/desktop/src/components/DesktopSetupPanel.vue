<script setup lang="ts">
/**
 * Initial local account form for the desktop manager.
 *
 * @module
 */

import { getShelfmarkToneMeta } from "@bunkobank/ui";
import { Check } from "@element-plus/icons-vue";
import { ElAlert, ElButton, ElCard, ElInput, ElTag } from "element-plus";
import { computed, useTemplateRef } from "vue";

import type { DesktopManagerState } from "../manager.js";
import {
  getSetupPresentation,
  localizeDesktopFieldError
} from "../presentation.js";

type SetupTextField = "username" | "password" | "confirmPassword";

const { state } = defineProps<{
  state: DesktopManagerState;
}>();
const emit = defineEmits<{
  submit: [];
  "update-text": [field: SetupTextField, value: string];
}>();
const setupForm = useTemplateRef<HTMLFormElement>("setup-form");
const setupComplete = computed(() => state.setup.phase === "complete");
const setupPresentation = computed(() =>
  getSetupPresentation(state.setup.phase)
);
const setupMeta = computed(() =>
  getShelfmarkToneMeta(setupPresentation.value.tone)
);

/** Reports native constraints before requesting asynchronous setup. */
const submitSetup = (): void => {
  if (setupForm.value?.reportValidity()) {
    emit("submit");
  }
};

/** Returns stable Japanese validation guidance for a setup field. */
const fieldError = (field: string): string =>
  localizeDesktopFieldError(field, state.setup.fieldErrors[field]);
</script>

<template>
  <ElCard class="setup-card status-spine" :class="setupMeta.className">
    <template #header>
      <div class="card-heading">
        <h2 id="setup-title">アカウント</h2>
        <ElTag :type="setupMeta.type" round>
          {{ setupPresentation.label }}
        </ElTag>
      </div>
    </template>
    <template #default>
      <ElAlert
        v-if="state.setup.phase === 'unavailable'"
        type="error"
        :closable="false"
        show-icon
      >
        データベースを確認できません。
      </ElAlert>

      <p v-else-if="setupComplete" class="complete">初期設定済み</p>

      <form
        v-else
        ref="setup-form"
        class="setup-form"
        action="/"
        method="post"
        novalidate
        :aria-busy="state.setup.phase === 'submitting'"
        @submit.prevent="submitSetup"
      >
        <div class="field">
          <label for="setup-username">ユーザー名</label>
          <ElInput
            id="setup-username"
            name="username"
            autocomplete="username"
            minlength="3"
            maxlength="30"
            pattern="[A-Za-z0-9_.]+"
            required
            class="fluid-control"
            :model-value="state.draft.username"
            :class="{
              'is-invalid': Boolean(state.setup.fieldErrors.username)
            }"
            :aria-invalid="Boolean(state.setup.fieldErrors.username)"
            aria-describedby="username-error"
            @update:model-value="
              $emit('update-text', 'username', String($event))
            "
          />
          <small id="username-error" class="field-error">
            {{ fieldError("username") }}
          </small>
        </div>

        <div class="password-grid">
          <div class="field">
            <label for="setup-password">パスワード</label>
            <ElInput
              id="setup-password"
              type="password"
              name="password"
              autocomplete="new-password"
              minlength="8"
              maxlength="128"
              aria-describedby="password-error"
              class="fluid-control"
              show-password
              required
              :model-value="state.draft.password"
              :class="{
                'is-invalid': Boolean(state.setup.fieldErrors.password)
              }"
              :aria-invalid="Boolean(state.setup.fieldErrors.password)"
              @update:model-value="
                $emit('update-text', 'password', String($event ?? ''))
              "
            />
            <small id="password-error" class="field-error">
              {{ fieldError("password") }}
            </small>
          </div>

          <div class="field">
            <label for="setup-confirm-password">パスワード（確認）</label>
            <ElInput
              id="setup-confirm-password"
              type="password"
              name="confirmPassword"
              autocomplete="new-password"
              minlength="8"
              maxlength="128"
              aria-describedby="confirm-password-error"
              class="fluid-control"
              show-password
              required
              :model-value="state.draft.confirmPassword"
              :class="{
                'is-invalid': Boolean(state.setup.fieldErrors.confirmPassword)
              }"
              :aria-invalid="Boolean(state.setup.fieldErrors.confirmPassword)"
              @update:model-value="
                $emit('update-text', 'confirmPassword', String($event ?? ''))
              "
            />
            <small id="confirm-password-error" class="field-error">
              {{ fieldError("confirmPassword") }}
            </small>
          </div>
        </div>

        <ElButton
          :icon="Check"
          native-type="submit"
          :loading="state.setup.phase === 'submitting'"
        >
          保存
        </ElButton>
      </form>
    </template>
  </ElCard>
</template>

<style scoped>
.setup-card {
  border-inline-start-width: 0.4rem;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.card-heading h2,
.complete {
  margin: 0;
}

.setup-form,
.field {
  display: grid;
}

.setup-form {
  gap: 1.25rem;
}

.field {
  gap: 0.4rem;
}

.field label {
  color: var(--bc-ink-soft);
  font-size: 0.8rem;
  font-weight: 700;
}

.password-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.field-error {
  min-block-size: 1.1rem;
  color: var(--bc-danger);
  font-size: 0.72rem;
}

.complete {
  color: var(--bc-ink-soft);
}

@media (width <= 42rem) {
  .password-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
