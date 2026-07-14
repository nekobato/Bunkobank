<script setup lang="ts">
const route = useRoute();
const { apiBase } = useBookApi();
const { session, signInWithUsername } = useBookAuth();
const username = ref("");
const password = ref("");
const showPassword = ref(false);
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
      message.value = result.error.message ?? "Sign in failed";
      return;
    }

    await navigateTo(redirectTo.value);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Sign in failed";
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <section class="login">
    <div class="panel">
      <div class="heading">
        <h1>Login</h1>
        <p v-if="hasSession">Signed in</p>
        <p v-else>BookCafe</p>
      </div>

      <form
        class="form"
        :action="`${apiBase}/auth/sign-in/username`"
        method="post"
        @submit.prevent="submitLogin"
      >
        <label class="field" for="username">
          <span>Username</span>
          <input
            id="username"
            v-model="username"
            name="username"
            autocomplete="username"
            enterkeyhint="next"
            required
          />
        </label>

        <label class="field" for="current-password">
          <span>Password</span>
          <input
            id="current-password"
            v-model="password"
            name="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            enterkeyhint="done"
            required
          />
        </label>

        <label class="toggle" for="show-password">
          <input
            id="show-password"
            v-model="showPassword"
            name="showPassword"
            type="checkbox"
          />
          <span>Show password</span>
        </label>

        <div class="actions">
          <button type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? "Signing in" : "Sign in" }}
          </button>
          <NuxtLink v-if="hasSession" to="/">Library</NuxtLink>
        </div>

        <p v-if="message" class="message is-error" aria-live="polite">
          {{ message }}
        </p>
      </form>
    </div>
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

.heading {
  display: grid;
  gap: 0.25rem;
}

.heading h1,
.heading p {
  margin: 0;
}

.heading h1 {
  font-size: clamp(1.6rem, 5vw, 2.2rem);
}

.heading p {
  color: var(--muted);
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
