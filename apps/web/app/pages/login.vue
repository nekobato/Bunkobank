<script setup lang="ts">
import { getApiErrorMessage } from "../utils/apiErrors";

const route = useRoute();
const { apiBase } = useBookApi();
const { session, signInWithUsername } = useBookAuth();
const username = ref("");
const password = ref("");
const message = ref("");
const isSubmitting = ref(false);
const redirectTo = computed(() =>
  typeof route.query.redirect === "string" ? route.query.redirect : "/"
);
const hasSession = computed(() => Boolean(session.value.data?.user));

/**
 * Signs in through Better Auth with the username plugin.
 */
const submitLogin = async (): Promise<void> => {
  isSubmitting.value = true;
  message.value = "";

  try {
    const result = await signInWithUsername({
      username: username.value,
      password: password.value
    });

    if (result.error) {
      message.value = "ユーザー名またはパスワードが正しくありません。";
      return;
    }

    await navigateTo(redirectTo.value);
  } catch (error) {
    message.value = getApiErrorMessage(
      error,
      "サーバーに接続できません。BookCafe Serverが起動しているか確認してから、再度お試しください。"
    );
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <section class="login">
    <div class="intro" aria-hidden="true">
      <span class="book book-one">BC</span>
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
          @submit.prevent="submitLogin"
        >
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
            />
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
                maxlength: 128
              }"
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
  place-items: start center;
  min-height: calc(100dvh - var(--app-topbar-height, 4rem));
  padding: clamp(1rem, 4vw, 2rem);
}

.panel {
  display: grid;
  gap: 1rem;
  width: min(420px, 100%);
}

.form {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field span,
.toggle {
  color: var(--muted);
  font-size: 0.9rem;
}

.field input {
  min-height: 2.5rem;
  padding: 0 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toggle input {
  width: 1rem;
  height: 1rem;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.actions button {
  min-height: 2.5rem;
  padding: 0 1rem;
  border: 0;
  border-radius: 6px;
  color: #fff;
  background: var(--accent);
  cursor: pointer;
}

.actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.actions a {
  color: var(--muted);
  font-size: 0.9rem;
}

.message {
  margin: 0;
  color: var(--muted);
}

.is-error {
  color: var(--danger);
}
</style>

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
  padding: 0;
  border: 0;
  background: transparent;
}

.field label {
  color: var(--bc-ink);
  font-size: 0.84rem;
  font-weight: 750;
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
