<script setup lang="ts">
/**
 * Initial account, library, and server settings.
 *
 * @module
 */

import {
  initialSetupRequestSchema,
  updateNetworkSettingsRequestSchema
} from "@bookcafe/contracts";

import { getApiErrorMessage } from "../utils/apiErrors";
import {
  createFieldErrorMap,
  focusFormErrorSummary
} from "../utils/formValidation";

const {
  apiBase,
  createInitialSetup,
  getNetworkSettings,
  getSetupStatus,
  getThumbnailSettings,
  updateNetworkSettings,
  updateThumbnailSettings
} = useBookApi();
const { error: libraryError, refreshLibraries } = useLibraries();
const { session, signInWithUsername } = useBookAuth();
const username = ref("");
const password = ref("");
const host = ref<"127.0.0.1" | "0.0.0.0">("127.0.0.1");
const port = ref(4510);
const thumbnailEnabled = ref(true);
const setupMessage = ref("");
const setupMessageSeverity = ref<"success" | "error">("success");
const networkMessage = ref("");
const networkMessageSeverity = ref<"success" | "error">("success");
const thumbnailMessage = ref("");
const thumbnailMessageSeverity = ref<"success" | "error">("success");
const isSavingSetup = ref(false);
const isSavingNetwork = ref(false);
const isSavingThumbnails = ref(false);
const setupFieldErrors = ref<Record<string, string>>({});
const networkFieldErrors = ref<Record<string, string>>({});
const setupErrorSummary = useTemplateRef<HTMLElement>("setup-error-summary");
const networkErrorSummary = useTemplateRef<HTMLElement>(
  "network-error-summary"
);
const {
  data: setupStatus,
  status: setupRequestStatus,
  error: setupError,
  refresh: refreshSetupStatus
} = await useAsyncData("setup-status", getSetupStatus, {
  server: false
});
const authenticated = computed(() => Boolean(session.value.data?.user));
const libraryErrorMessage = computed(() =>
  getApiErrorMessage(libraryError.value, "ライブラリを読み込めませんでした。")
);
const canUseProtectedApi = computed(
  () => setupStatus.value?.setupComplete === true && authenticated.value
);
const { data: networkData } = await useAsyncData(
  "network-settings",
  () =>
    canUseProtectedApi.value ? getNetworkSettings() : Promise.resolve(null),
  {
    default: () => null,
    server: false,
    watch: [canUseProtectedApi]
  }
);
const { data: thumbnailData } = await useAsyncData(
  "thumbnail-settings",
  () =>
    canUseProtectedApi.value ? getThumbnailSettings() : Promise.resolve(null),
  {
    default: () => null,
    server: false,
    watch: [canUseProtectedApi]
  }
);

watch(
  networkData,
  (settings) => {
    if (settings) {
      host.value = settings.host;
      port.value = settings.port;
    }
  },
  { immediate: true }
);

watch(
  thumbnailData,
  (settings) => {
    if (settings) {
      thumbnailEnabled.value = settings.enabled;
    }
  },
  { immediate: true }
);

/** Creates the initial user and signs into the new account. */
const submitSetup = async (): Promise<void> => {
  const validation = initialSetupRequestSchema.safeParse({
    username: username.value,
    password: password.value
  });

  if (!validation.success) {
    const errors = createFieldErrorMap(validation.error.issues);
    setupFieldErrors.value = {
      ...(errors.username
        ? {
            username:
              "ユーザー名は3〜30文字の半角英数字、_、.で入力してください。"
          }
        : {}),
      ...(errors.password
        ? { password: "パスワードは8〜128文字で入力してください。" }
        : {})
    };
    await focusFormErrorSummary(setupErrorSummary.value);
    return;
  }

  isSavingSetup.value = true;
  setupMessage.value = "";
  setupFieldErrors.value = {};

  try {
    await createInitialSetup(validation.data);
    const signInResult = await signInWithUsername(validation.data);

    setupMessageSeverity.value = "success";
    setupMessage.value = signInResult.error
      ? "保存しました。ログインしてください。"
      : "初期設定を保存しました。";
    await refreshSetupStatus();

    if (!signInResult.error) {
      await refreshLibraries();
    }
  } catch (error) {
    setupMessageSeverity.value = "error";
    setupMessage.value = getApiErrorMessage(
      error,
      "初期設定を保存できませんでした。"
    );
  } finally {
    isSavingSetup.value = false;
  }
};

/** Saves persisted network settings. */
const submitNetworkSettings = async (): Promise<void> => {
  const validation = updateNetworkSettingsRequestSchema.safeParse({
    host: host.value,
    port: port.value
  });

  if (!validation.success) {
    const errors = createFieldErrorMap(validation.error.issues);
    networkFieldErrors.value = {
      ...(errors.host ? { host: "待受アドレスを選択してください。" } : {}),
      ...(errors.port
        ? { port: "ポートは1〜65535の整数で入力してください。" }
        : {})
    };
    await focusFormErrorSummary(networkErrorSummary.value);
    return;
  }

  isSavingNetwork.value = true;
  networkMessage.value = "";
  networkFieldErrors.value = {};

  try {
    const response = await updateNetworkSettings(validation.data);
    networkData.value = response;
    networkMessageSeverity.value = "success";
    networkMessage.value = response.restartRequired
      ? "保存しました。再起動後に反映されます。"
      : "保存しました。";
  } catch (error) {
    networkMessageSeverity.value = "error";
    networkMessage.value = getApiErrorMessage(error, "保存できませんでした。");
  } finally {
    isSavingNetwork.value = false;
  }
};

/** Saves the thumbnail-generation setting. */
const submitThumbnailSettings = async (): Promise<void> => {
  isSavingThumbnails.value = true;
  thumbnailMessage.value = "";

  try {
    thumbnailData.value = await updateThumbnailSettings({
      enabled: thumbnailEnabled.value
    });
    thumbnailMessageSeverity.value = "success";
    thumbnailMessage.value = "保存しました。";
  } catch (error) {
    thumbnailMessageSeverity.value = "error";
    thumbnailMessage.value = getApiErrorMessage(
      error,
      "保存できませんでした。"
    );
  } finally {
    isSavingThumbnails.value = false;
  }
};
</script>

<template>
  <section class="setup">
    <header>
      <h1 class="page-title">設定</h1>
    </header>

    <ClientOnly>
      <Message
        v-if="setupRequestStatus === 'error'"
        severity="error"
        :closable="false"
      >
        <span>設定を確認できません</span>
        <span>
          {{
            getApiErrorMessage(setupError, "BookCafeへ接続できませんでした。")
          }}
        </span>
        <Button
          label="再試行"
          icon="pi pi-refresh"
          size="small"
          @click="() => refreshSetupStatus()"
        />
      </Message>

      <div
        v-else-if="['idle', 'pending'].includes(setupRequestStatus)"
        class="loading"
        role="status"
      >
        <ProgressSpinner class="spinner" stroke-width="4" />
      </div>

      <Card v-else-if="setupStatus?.setupComplete === false">
        <template #title>初期設定</template>
        <template #content>
          <form
            class="form"
            :action="`${apiBase}/setup/initial-user`"
            method="post"
            @submit.prevent="submitSetup"
          >
            <div
              v-if="Object.keys(setupFieldErrors).length > 0"
              ref="setup-error-summary"
              class="error-summary"
              tabindex="-1"
              role="alert"
            >
              <strong>入力内容を確認してください。</strong>
              <ul>
                <li v-if="setupFieldErrors.username">
                  <a href="#setup-username">{{ setupFieldErrors.username }}</a>
                </li>
                <li v-if="setupFieldErrors.password">
                  <a href="#setup-password">{{ setupFieldErrors.password }}</a>
                </li>
              </ul>
            </div>
            <div class="field">
              <label for="setup-username">ユーザー名</label>
              <InputText
                id="setup-username"
                v-model="username"
                name="username"
                autocomplete="username"
                minlength="3"
                maxlength="30"
                pattern="[A-Za-z0-9_.]+"
                required
                fluid
                :invalid="Boolean(setupFieldErrors.username)"
                :aria-invalid="Boolean(setupFieldErrors.username)"
                aria-describedby="setup-username-error"
              />
              <small
                v-if="setupFieldErrors.username"
                id="setup-username-error"
                class="field-error"
              >
                {{ setupFieldErrors.username }}
              </small>
            </div>
            <div class="field">
              <label for="setup-password">パスワード</label>
              <InputText
                id="setup-password"
                v-model="password"
                name="password"
                type="password"
                autocomplete="new-password"
                minlength="8"
                maxlength="128"
                required
                fluid
                :invalid="Boolean(setupFieldErrors.password)"
                :aria-invalid="Boolean(setupFieldErrors.password)"
                aria-describedby="setup-password-error"
              />
              <small
                v-if="setupFieldErrors.password"
                id="setup-password-error"
                class="field-error"
              >
                {{ setupFieldErrors.password }}
              </small>
            </div>
            <Button
              label="保存"
              icon="pi pi-check"
              type="submit"
              :loading="isSavingSetup"
            />
            <Message
              v-if="setupMessage"
              :severity="setupMessageSeverity"
              :closable="false"
            >
              {{ setupMessage }}
            </Message>
          </form>
        </template>
      </Card>

      <Card v-else-if="!authenticated">
        <template #content>
          <Button
            as="router-link"
            label="ログイン"
            icon="pi pi-sign-in"
            to="/login"
          />
        </template>
      </Card>

      <template v-else>
        <Message v-if="libraryError" severity="error" :closable="false">
          <span>{{ libraryErrorMessage }}</span>
          <Button
            label="再試行"
            icon="pi pi-refresh"
            size="small"
            @click="refreshLibraries"
          />
        </Message>

        <Card>
          <template #content>
            <LibraryManager />
          </template>
        </Card>

        <div class="settings-grid">
          <Card>
            <template #title>ネットワーク</template>
            <template #content>
              <form class="form" @submit.prevent="submitNetworkSettings">
                <div
                  v-if="Object.keys(networkFieldErrors).length > 0"
                  ref="network-error-summary"
                  class="error-summary"
                  tabindex="-1"
                  role="alert"
                >
                  <strong>入力内容を確認してください。</strong>
                  <ul>
                    <li v-if="networkFieldErrors.host">
                      <a href="#network-host">{{ networkFieldErrors.host }}</a>
                    </li>
                    <li v-if="networkFieldErrors.port">
                      <a href="#network-port">{{ networkFieldErrors.port }}</a>
                    </li>
                  </ul>
                </div>
                <div class="field">
                  <span id="network-host-label" class="control-label">
                    待受アドレス
                  </span>
                  <Select
                    v-model="host"
                    input-id="network-host"
                    :options="[
                      { label: 'この端末のみ', value: '127.0.0.1' },
                      { label: 'ローカルネットワーク', value: '0.0.0.0' }
                    ]"
                    option-label="label"
                    option-value="value"
                    aria-labelledby="network-host-label"
                    :invalid="Boolean(networkFieldErrors.host)"
                    fluid
                  />
                  <small v-if="networkFieldErrors.host" class="field-error">
                    {{ networkFieldErrors.host }}
                  </small>
                </div>
                <Message
                  v-if="host === '0.0.0.0'"
                  severity="warn"
                  :closable="false"
                >
                  すべてのネットワークインターフェースで待ち受けます。ファイアウォールを確認してください。
                </Message>
                <div class="field">
                  <label for="network-port">ポート</label>
                  <InputNumber
                    v-model="port"
                    input-id="network-port"
                    :min="1"
                    :max="65535"
                    :use-grouping="false"
                    required
                    fluid
                    :invalid="Boolean(networkFieldErrors.port)"
                    :input-props="{
                      'aria-invalid': Boolean(networkFieldErrors.port),
                      'aria-describedby': 'network-port-error'
                    }"
                  />
                  <small
                    v-if="networkFieldErrors.port"
                    id="network-port-error"
                    class="field-error"
                  >
                    {{ networkFieldErrors.port }}
                  </small>
                </div>
                <Button
                  label="保存"
                  icon="pi pi-check"
                  type="submit"
                  :loading="isSavingNetwork"
                />
                <Message
                  v-if="networkMessage"
                  :severity="networkMessageSeverity"
                  :closable="false"
                >
                  {{ networkMessage }}
                </Message>
              </form>
            </template>
          </Card>

          <Card>
            <template #title>サムネイル</template>
            <template #content>
              <form class="form" @submit.prevent="submitThumbnailSettings">
                <label class="toggle" for="thumbnail-enabled">
                  <span>生成する</span>
                  <ToggleSwitch
                    v-model="thumbnailEnabled"
                    input-id="thumbnail-enabled"
                  />
                </label>
                <Button
                  label="保存"
                  icon="pi pi-check"
                  type="submit"
                  :loading="isSavingThumbnails"
                />
                <Message
                  v-if="thumbnailMessage"
                  :severity="thumbnailMessageSeverity"
                  :closable="false"
                >
                  {{ thumbnailMessage }}
                </Message>
              </form>
            </template>
          </Card>
        </div>
      </template>

      <template #fallback>
        <div class="loading" role="status">
          <ProgressSpinner class="spinner" stroke-width="4" />
        </div>
      </template>
    </ClientOnly>
  </section>
</template>

<style scoped>
.setup {
  display: grid;
  gap: 1.25rem;
  inline-size: min(72rem, 100%);
  padding: clamp(1.25rem, 4vw, 3.5rem);
  margin: 0 auto;
}

.setup h1 {
  margin: 0;
}

.form {
  display: grid;
  gap: 1rem;
}

.field {
  display: grid;
  gap: 0.4rem;
}

.field label,
.field .control-label,
.toggle span {
  color: var(--bc-ink-soft);
  font-size: 0.8rem;
  font-weight: 700;
}

.field-error {
  color: var(--bc-danger);
  font-size: 0.75rem;
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

.error-summary ul {
  margin-block: 0.5rem 0;
}

.error-summary a {
  color: inherit;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 1rem;
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.loading {
  display: grid;
  min-block-size: 8rem;
  place-items: center;
}

.spinner {
  inline-size: 2rem;
  block-size: 2rem;
}

@media (width <= 48rem) {
  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
