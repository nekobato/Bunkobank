<script setup lang="ts">
const { session, signOut } = useBookAuth();
const hasSession = computed(() => Boolean(session.value.data?.user));
const userLabel = computed(
  () =>
    session.value.data?.user.name ??
    session.value.data?.user.email ??
    "Signed in"
);

/**
 * Signs the current user out and moves back to the login screen.
 */
const submitSignOut = async (): Promise<void> => {
  await signOut();
  await navigateTo("/login");
};
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <NuxtLink class="brand" to="/">BookCafe</NuxtLink>
      <nav class="nav" aria-label="Primary">
        <NuxtLink to="/">Library</NuxtLink>
        <NuxtLink to="/setup">Setup</NuxtLink>
        <ClientOnly>
          <div v-if="hasSession" class="account">
            <span class="user">{{ userLabel }}</span>
            <button type="button" @click="submitSignOut">Sign out</button>
          </div>
          <NuxtLink v-else to="/login">Login</NuxtLink>
        </ClientOnly>
      </nav>
    </header>
    <main id="content" class="content" tabindex="-1">
      <NuxtPage />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100dvh;
  color: var(--text);
  background: var(--surface);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem clamp(1rem, 4vw, 2rem);
  border-bottom: 1px solid var(--line);
  background: color-mix(in oklab, var(--surface) 92%, transparent);
  backdrop-filter: blur(12px);
}

.brand {
  color: var(--text);
  font-size: 1rem;
  font-weight: 700;
  text-decoration: none;
}

.nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.nav a,
.account button {
  color: var(--muted);
  font-size: 0.9rem;
  text-decoration: none;
}

.nav a.router-link-active {
  color: var(--text);
}

.account {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.account button {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.account button:hover {
  color: var(--text);
}

.user {
  max-width: min(16rem, 34vw);
  overflow: hidden;
  color: var(--text);
  font-size: 0.9rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  min-height: calc(100dvh - 57px);
}
</style>
