<script setup lang="ts">
/**
 * Initial account, library, and server settings.
 *
 * @module
 */

import {
  initialSetupRequestSchema,
  updateNetworkSettingsRequestSchema
} from "@bunkobank/contracts";

import { getApiErrorMessage } from "../utils/apiErrors";
import {
  createFieldErrorMap,
  focusFormErrorSummary
} from "../utils/formValidation";

useHead({ title: "設定" });

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
const hostOptions = [
  { label: "この端末のみ", value: "127.0.0.1" },
  { label: "ローカルネットワーク", value: "0.0.0.0" }
] as const;
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
      <ElAlert
        v-if="setupRequestStatus === 'error'"
        type="error"
        :closable="false"
        show-icon
      >
        <span>設定を確認できません</span>
        <span>
          {{
            getApiErrorMessage(setupError, "Bunkobankへ接続できませんでした。")
          }}
        </span>
        <ElButton
          :icon="ElIconRefresh"
          size="small"
          @click="() => refreshSetupStatus()"
        >
          再試行
        </ElButton>
      </ElAlert>

      <div
        v-else-if="['idle', 'pending'].includes(setupRequestStatus)"
        class="loading"
        role="status"
      >
        <LoadingIndicator class="spinner" />
      </div>

      <ElCard v-else-if="setupStatus?.setupComplete === false">
        <template #header>初期設定</template>
        <template #default>
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
              <ElInput
                id="setup-username"
                v-model="username"
                name="username"
                autocomplete="username"
                minlength="3"
                maxlength="30"
                pattern="[A-Za-z0-9_.]+"
                required
                :aria-invalid="Boolean(setupFieldErrors.username)"
                aria-describedby="setup-username-error"
                class="fluid-control"
                :class="{ 'is-invalid': Boolean(setupFieldErrors.username) }"
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
              <ElInput
                id="setup-password"
                v-model="password"
                name="password"
                type="password"
                autocomplete="new-password"
                minlength="8"
                maxlength="128"
                show-password
                required
                :aria-invalid="Boolean(setupFieldErrors.password)"
                aria-describedby="setup-password-error"
                class="fluid-control"
                :class="{ 'is-invalid': Boolean(setupFieldErrors.password) }"
              />
              <small
                v-if="setupFieldErrors.password"
                id="setup-password-error"
                class="field-error"
              >
                {{ setupFieldErrors.password }}
              </small>
            </div>
            <ElButton
              :icon="ElIconCheck"
              native-type="submit"
              :loading="isSavingSetup"
            >
              保存
            </ElButton>
            <ElAlert
              v-if="setupMessage"
              :type="setupMessageSeverity"
              :closable="false"
              show-icon
            >
              {{ setupMessage }}
            </ElAlert>
          </form>
        </template>
      </ElCard>

      <ElCard v-else-if="!authenticated">
        <template #default>
          <NuxtLink class="button-link" to="/login">
            <ElButton :icon="ElIconRight">ログイン</ElButton>
          </NuxtLink>
        </template>
      </ElCard>

      <template v-else>
        <ElAlert v-if="libraryError" type="error" :closable="false" show-icon>
          <span>{{ libraryErrorMessage }}</span>
          <ElButton
            :icon="ElIconRefresh"
            size="small"
            @click="refreshLibraries"
          >
            再試行
          </ElButton>
        </ElAlert>

        <ElCard>
          <template #default>
            <LibraryManager />
          </template>
        </ElCard>

        <div class="settings-grid">
          <ElCard>
            <template #header>ネットワーク</template>
            <template #default>
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
                  <label
                    id="network-host-label"
                    class="control-label"
                    for="network-host"
                  >
                    待受アドレス
                  </label>
                  <ElSelect
                    id="network-host"
                    v-model="host"
                    aria-labelledby="network-host-label"
                    class="fluid-control"
                    :class="{
                      'is-invalid': Boolean(networkFieldErrors.host)
                    }"
                    :aria-invalid="Boolean(networkFieldErrors.host)"
                  >
                    <ElOption
                      v-for="option in hostOptions"
                      :key="option.value"
                      :label="option.label"
                      :value="option.value"
                    />
                  </ElSelect>
                  <small v-if="networkFieldErrors.host" class="field-error">
                    {{ networkFieldErrors.host }}
                  </small>
                </div>
                <ElAlert
                  v-if="host === '0.0.0.0'"
                  type="warning"
                  :closable="false"
                  show-icon
                >
                  すべてのネットワークインターフェースで待ち受けます。ファイアウォールを確認してください。
                </ElAlert>
                <div class="field">
                  <label for="network-port">ポート</label>
                  <ElInputNumber
                    id="network-port"
                    v-model="port"
                    :min="1"
                    :max="65535"
                    :controls="false"
                    aria-describedby="network-port-error"
                    class="fluid-control"
                    :class="{
                      'is-invalid': Boolean(networkFieldErrors.port)
                    }"
                    :aria-invalid="Boolean(networkFieldErrors.port)"
                  />
                  <small
                    v-if="networkFieldErrors.port"
                    id="network-port-error"
                    class="field-error"
                  >
                    {{ networkFieldErrors.port }}
                  </small>
                </div>
                <ElButton
                  :icon="ElIconCheck"
                  native-type="submit"
                  :loading="isSavingNetwork"
                >
                  保存
                </ElButton>
                <ElAlert
                  v-if="networkMessage"
                  :type="networkMessageSeverity"
                  :closable="false"
                  show-icon
                >
                  {{ networkMessage }}
                </ElAlert>
              </form>
            </template>
          </ElCard>

          <ElCard>
            <template #header>サムネイル</template>
            <template #default>
              <form class="form" @submit.prevent="submitThumbnailSettings">
                <label class="toggle" for="thumbnail-enabled">
                  <span>生成する</span>
                  <ElSwitch id="thumbnail-enabled" v-model="thumbnailEnabled" />
                </label>
                <ElButton
                  :icon="ElIconCheck"
                  native-type="submit"
                  :loading="isSavingThumbnails"
                >
                  保存
                </ElButton>
                <ElAlert
                  v-if="thumbnailMessage"
                  :type="thumbnailMessageSeverity"
                  :closable="false"
                  show-icon
                >
                  {{ thumbnailMessage }}
                </ElAlert>
              </form>
            </template>
          </ElCard>
        </div>
      </template>

      <template #fallback>
        <div class="loading" role="status">
          <LoadingIndicator class="spinner" />
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

.button-link {
  text-decoration: none;
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
