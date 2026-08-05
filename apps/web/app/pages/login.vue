<script setup lang="ts">
import { initialSetupRequestSchema } from "@bunkobank/contracts";

import { getApiErrorMessage } from "../utils/apiErrors";
import { getLoginRedirect } from "../utils/authRedirect";
import {
  createFieldErrorMap,
  focusFormErrorSummary
} from "../utils/formValidation";

useHead({ title: "ログイン" });

const route = useRoute();
const { apiBase } = useBookApi();
const { session, signInWithUsername } = useBookAuth();
const username = ref("");
const password = ref("");
const message = ref("");
const fieldErrors = ref<Record<string, string>>({});
const errorSummary = useTemplateRef<HTMLElement>("login-error-summary");
const isSubmitting = ref(false);
const redirectTo = computed(() => getLoginRedirect(route.query.redirect));
const hasSession = computed(() => Boolean(session.value.data?.user));

watch(
  hasSession,
  async (authenticated) => {
    if (authenticated) {
      await navigateTo(redirectTo.value, { replace: true });
    }
  },
  { immediate: true }
);

/**
 * Signs in through Better Auth with the username plugin.
 */
const submitLogin = async (): Promise<void> => {
  const validation = initialSetupRequestSchema.safeParse({
    username: username.value,
    password: password.value
  });

  if (!validation.success) {
    const errors = createFieldErrorMap(validation.error.issues);
    fieldErrors.value = {
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
    await focusFormErrorSummary(errorSummary.value);
    return;
  }

  isSubmitting.value = true;
  message.value = "";
  fieldErrors.value = {};

  try {
    const result = await signInWithUsername(validation.data);

    if (result.error) {
      message.value = "ユーザー名またはパスワードが正しくありません。";
      return;
    }

    await navigateTo(redirectTo.value);
  } catch (error) {
    message.value = getApiErrorMessage(
      error,
      "サーバーに接続できません。Bunkobank Serverが起動しているか確認してから、再度お試しください。"
    );
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <section v-if="!hasSession" class="login">
    <div class="intro" aria-hidden="true">
      <span class="book book-one">BB</span>
      <span class="book book-two" />
      <span class="book book-three" />
    </div>

    <Card class="login-card status-spine tone-info">
      <template #title>
        <h1>ログイン</h1>
      </template>
      <template #content>
        <form
          class="form"
          :action="`${apiBase}/auth/sign-in/username`"
          method="post"
          novalidate
          @submit.prevent="submitLogin"
        >
          <div
            v-if="Object.keys(fieldErrors).length > 0"
            ref="login-error-summary"
            class="error-summary"
            tabindex="-1"
            role="alert"
          >
            <strong>入力内容を確認してください。</strong>
            <a v-if="fieldErrors.username" href="#username">
              {{ fieldErrors.username }}
            </a>
            <a v-if="fieldErrors.password" href="#current-password">
              {{ fieldErrors.password }}
            </a>
          </div>
          <div class="field">
            <label for="username">ユーザー名</label>
            <InputText
              id="username"
              v-model="username"
              name="username"
              autocomplete="username"
              spellcheck="false"
              enterkeyhint="next"
              minlength="3"
              maxlength="30"
              required
              fluid
              :invalid="Boolean(fieldErrors.username)"
              :aria-invalid="Boolean(fieldErrors.username)"
              aria-describedby="login-username-error"
            />
            <small v-if="fieldErrors.username" id="login-username-error">
              {{ fieldErrors.username }}
            </small>
          </div>

          <div class="field">
            <label for="current-password">パスワード</label>
            <Password
              v-model="password"
              input-id="current-password"
              name="password"
              :feedback="false"
              toggle-mask
              required
              fluid
              :input-props="{
                autocomplete: 'current-password',
                minlength: 8,
                maxlength: 128,
                'aria-invalid': Boolean(fieldErrors.password),
                'aria-describedby': 'login-password-error'
              }"
              :invalid="Boolean(fieldErrors.password)"
            >
              <template #unmaskicon="{ toggleCallback }">
                <button
                  class="password-toggle"
                  type="button"
                  aria-label="パスワードを表示"
                  @click="toggleCallback"
                >
                  <i class="pi pi-eye" aria-hidden="true" />
                </button>
              </template>
              <template #maskicon="{ toggleCallback }">
                <button
                  class="password-toggle"
                  type="button"
                  aria-label="パスワードを隠す"
                  @click="toggleCallback"
                >
                  <i class="pi pi-eye-slash" aria-hidden="true" />
                </button>
              </template>
            </Password>
            <small v-if="fieldErrors.password" id="login-password-error">
              {{ fieldErrors.password }}
            </small>
          </div>

          <Message v-if="message" severity="error" :closable="false">
            {{ message }}
          </Message>

          <div class="actions">
            <Button
              label="ログイン"
              icon="pi pi-sign-in"
              type="submit"
              :loading="isSubmitting"
            />
            <NuxtLink v-if="hasSession" to="/">ライブラリへ戻る</NuxtLink>
          </div>
        </form>
      </template>
    </Card>
  </section>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(12rem, 0.75fr) minmax(20rem, 1fr);
  place-items: center;
  gap: clamp(2rem, 8vw, 7rem);
  min-block-size: calc(100dvh - var(--app-topbar-height, 4.25rem));
  background:
    radial-gradient(
      circle at 18% 30%,
      color-mix(in oklab, var(--bc-patina) 22%, transparent),
      transparent 25rem
    ),
    var(--bc-fog);
  padding: clamp(1.25rem, 6vw, 5rem);
}

.intro {
  display: flex;
  align-items: end;
  justify-content: center;
  inline-size: 100%;
  min-block-size: 22rem;
  border-block-end: 0.75rem solid var(--bc-deep-shelf);
}

.book {
  display: grid;
  place-items: center;
  inline-size: clamp(4rem, 8vw, 6.5rem);
  border-radius: 0.25rem 0.8rem 0.8rem 0.25rem;
  color: white;
  font-family: var(--bc-font-data);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  box-shadow: inset 0.45rem 0 rgb(0 0 0 / 14%);
}

.book-one {
  block-size: 16rem;
  background: var(--bc-ink-blue);
}

.book-two {
  block-size: 19rem;
  background: var(--bc-spine-coral);
}

.book-three {
  block-size: 14rem;
  background: var(--bc-patina);
}

.login-card {
  inline-size: min(29rem, 100%);
}

.login-card h1 {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.6rem);
  letter-spacing: -0.04em;
}

.form {
  display: grid;
  gap: 1rem;
  padding: 0;
  border: 0;
  background: transparent;
}

.error-summary {
  display: grid;
  gap: 0.35rem;
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

.field {
  display: grid;
  gap: 0.35rem;
}

.field label {
  color: var(--bc-ink);
  font-size: 0.84rem;
  font-weight: 750;
}

.field small {
  color: var(--bc-danger);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.actions a {
  color: var(--bc-ink-blue);
  font-size: 0.84rem;
}

@media (width <= 44rem) {
  .login {
    grid-template-columns: minmax(0, 1fr);
  }

  .intro {
    display: none;
  }
}
</style>
