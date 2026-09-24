<script setup lang="ts">
/** Creates either a directory-backed or encrypted Bunkobank library. */

import type { LibraryResponse } from "@bunkobank/contracts";
import { libraryCreateRequestSchema } from "@bunkobank/contracts";

import { getApiErrorMessage } from "../utils/apiErrors";
import {
  createFieldErrorMap,
  focusFormErrorSummary
} from "../utils/formValidation";

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{
  created: [library: LibraryResponse];
}>();
const { createLibrary } = useBookApi();

const kind = ref<"directory" | "encrypted" | undefined>(undefined);
const name = ref("");
const rootPath = ref("");
const password = ref("");
const passwordConfirmation = ref("");
const isCreating = ref(false);
const fieldErrors = ref<Record<string, string>>({});
const formError = ref("");
const errorSummary = useTemplateRef<HTMLElement>("error-summary");

const isEncrypted = computed(() => kind.value === "encrypted");
const submitLabel = computed(() =>
  isEncrypted.value ? "暗号化ライブラリを作成" : "ライブラリを追加"
);

/** Resets transient credentials whenever the drawer closes. */
const resetForm = (): void => {
  kind.value = undefined;
  name.value = "";
  rootPath.value = "";
  password.value = "";
  passwordConfirmation.value = "";
  fieldErrors.value = {};
  formError.value = "";
};

/** Validates and creates the selected library kind. */
const submit = async (): Promise<void> => {
  fieldErrors.value = {};
  formError.value = "";

  if (!kind.value) {
    fieldErrors.value = { kind: "ライブラリの種類を選択してください。" };
    await focusFormErrorSummary(errorSummary.value);
    return;
  }

  if (isEncrypted.value && password.value !== passwordConfirmation.value) {
    fieldErrors.value = { passwordConfirmation: "パスワードが一致しません。" };
    await focusFormErrorSummary(errorSummary.value);
    return;
  }

  const validation = libraryCreateRequestSchema.safeParse(
    isEncrypted.value
      ? {
          kind: "encrypted",
          name: name.value,
          rootPath: rootPath.value,
          password: password.value
        }
      : { kind: "directory", name: name.value, rootPath: rootPath.value }
  );

  if (!validation.success) {
    const errors = createFieldErrorMap(validation.error.issues);
    fieldErrors.value = {
      ...(errors.name ? { name: "名前を1〜100文字で入力してください。" } : {}),
      ...(errors.rootPath
        ? { rootPath: "対象ディレクトリを入力してください。" }
        : {}),
      ...(errors.password
        ? { password: "パスワードは8〜128文字で入力してください。" }
        : {})
    };
    await focusFormErrorSummary(errorSummary.value);
    return;
  }

  isCreating.value = true;

  try {
    const library = await createLibrary(validation.data);
    emit("created", library);
    open.value = false;
  } catch (error) {
    formError.value = getApiErrorMessage(
      error,
      "ライブラリを追加できませんでした。"
    );
    await focusFormErrorSummary(errorSummary.value);
  } finally {
    isCreating.value = false;
  }
};
</script>

<template>
  <ElDrawer
    v-model="open"
    title="ライブラリを追加"
    direction="rtl"
    size="min(34rem, 100%)"
    destroy-on-close
    @closed="resetForm"
  >
    <form id="library-create-form" class="form" @submit.prevent="submit">
      <div
        v-if="Object.keys(fieldErrors).length > 0 || formError"
        ref="error-summary"
        class="error-summary"
        tabindex="-1"
        role="alert"
      >
        <strong>入力内容を確認してください。</strong>
        <a v-if="fieldErrors.kind" href="#library-kind">
          {{ fieldErrors.kind }}
        </a>
        <a v-if="fieldErrors.name" href="#library-create-name">
          {{ fieldErrors.name }}
        </a>
        <a v-if="fieldErrors.rootPath" href="#library-create-root-path">
          {{ fieldErrors.rootPath }}
        </a>
        <a v-if="fieldErrors.password" href="#library-create-password">
          {{ fieldErrors.password }}
        </a>
        <a
          v-if="fieldErrors.passwordConfirmation"
          href="#library-create-password-confirmation"
        >
          {{ fieldErrors.passwordConfirmation }}
        </a>
        <span v-if="formError">{{ formError }}</span>
      </div>

      <fieldset class="kind-fieldset" :aria-invalid="Boolean(fieldErrors.kind)">
        <legend>ライブラリの種類</legend>
        <ElRadioGroup id="library-kind" v-model="kind" class="kind-options">
          <ElRadio value="directory" class="kind-option">
            <span class="kind-option-title">フォルダー参照</span>
            <span class="kind-option-copy">
              既存ディレクトリを読み取り、スキャンで本を見つけます。
            </span>
          </ElRadio>
          <ElRadio value="encrypted" class="kind-option">
            <span class="kind-option-title">暗号化ライブラリ</span>
            <span class="kind-option-copy">
              保存先を指定してから、対応ファイルを追加します。
            </span>
          </ElRadio>
        </ElRadioGroup>
      </fieldset>

      <div class="field">
        <label for="library-create-name">名前</label>
        <ElInput
          id="library-create-name"
          v-model="name"
          name="name"
          autocomplete="off"
          maxlength="100"
          required
          :aria-invalid="Boolean(fieldErrors.name)"
          aria-describedby="library-create-name-error"
          :class="{ 'is-invalid': Boolean(fieldErrors.name) }"
        />
        <small
          v-if="fieldErrors.name"
          id="library-create-name-error"
          class="field-error"
        >
          {{ fieldErrors.name }}
        </small>
      </div>

      <div class="field">
        <label for="library-create-root-path">
          {{ isEncrypted ? "暗号化ファイルの保存先" : "対象ディレクトリ" }}
        </label>
        <ElInput
          id="library-create-root-path"
          v-model="rootPath"
          name="rootPath"
          autocomplete="off"
          maxlength="32767"
          required
          :aria-invalid="Boolean(fieldErrors.rootPath)"
          aria-describedby="library-create-root-path-error"
          :class="{ 'is-invalid': Boolean(fieldErrors.rootPath) }"
        />
        <small
          v-if="fieldErrors.rootPath"
          id="library-create-root-path-error"
          class="field-error"
        >
          {{ fieldErrors.rootPath }}
        </small>
      </div>

      <template v-if="isEncrypted">
        <div class="field">
          <label for="library-create-password">パスワード</label>
          <ElInput
            id="library-create-password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
            show-password
            :aria-invalid="Boolean(fieldErrors.password)"
            aria-describedby="library-create-password-error password-warning"
            :class="{ 'is-invalid': Boolean(fieldErrors.password) }"
          />
          <small
            v-if="fieldErrors.password"
            id="library-create-password-error"
            class="field-error"
          >
            {{ fieldErrors.password }}
          </small>
        </div>
        <div class="field">
          <label for="library-create-password-confirmation">
            パスワードを再入力
          </label>
          <ElInput
            id="library-create-password-confirmation"
            v-model="passwordConfirmation"
            name="passwordConfirmation"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
            show-password
            :aria-invalid="Boolean(fieldErrors.passwordConfirmation)"
            aria-describedby="library-create-password-confirmation-error"
            :class="{ 'is-invalid': Boolean(fieldErrors.passwordConfirmation) }"
          />
          <small
            v-if="fieldErrors.passwordConfirmation"
            id="library-create-password-confirmation-error"
            class="field-error"
          >
            {{ fieldErrors.passwordConfirmation }}
          </small>
        </div>
        <p id="password-warning" class="password-warning">
          パスワードを忘れると、このライブラリは復旧できません。
        </p>
      </template>
    </form>
    <template #footer>
      <ElButton type="info" text :disabled="isCreating" @click="open = false">
        キャンセル
      </ElButton>
      <ElButton
        form="library-create-form"
        native-type="submit"
        :loading="isCreating"
      >
        {{ submitLabel }}
      </ElButton>
    </template>
  </ElDrawer>
</template>

<style scoped>
.form,
.kind-options,
.field,
.error-summary {
  display: grid;
  gap: 0.75rem;
}

.form {
  gap: 1.25rem;
}

.kind-fieldset {
  display: grid;
  gap: 0.75rem;
  border: 0;
  padding: 0;
  margin: 0;
}

.kind-fieldset legend,
.field label {
  color: var(--bc-ink-soft);
  font-size: 0.78rem;
  font-weight: 700;
}

.kind-options {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.kind-option {
  align-items: start;
  min-inline-size: 0;
  border: 1px solid var(--bc-line-soft);
  border-radius: 0.75rem;
  padding: 0.85rem;
  margin: 0;
}

.kind-option:has(.is-checked) {
  border-color: var(--bc-ink-blue);
  background: color-mix(in oklab, var(--bc-ink-blue) 7%, var(--bc-panel));
}

.kind-option :deep(.el-radio__label) {
  display: grid;
  gap: 0.3rem;
  min-inline-size: 0;
  white-space: normal;
}

.kind-option-title {
  color: var(--bc-ink);
  font-weight: 700;
}

.kind-option-copy,
.password-warning,
.field-error {
  color: var(--bc-ink-soft);
  font-size: 0.78rem;
  line-height: 1.55;
}

.field-error {
  color: var(--bc-danger);
}

.password-warning {
  border-inline-start: 0.25rem solid var(--bc-ink-blue);
  padding-inline-start: 0.75rem;
  margin: -0.25rem 0 0;
}

.error-summary {
  border-inline-start: 0.3rem solid var(--bc-danger);
  padding: 0.75rem 1rem;
  color: var(--bc-danger);
  background: color-mix(in oklab, var(--bc-danger) 8%, var(--bc-panel));
}

.error-summary:focus {
  outline: 2px solid var(--bc-danger);
  outline-offset: 2px;
}

.error-summary a {
  color: inherit;
}

@media (width <= 34rem) {
  .kind-options {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
