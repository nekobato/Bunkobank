<script setup lang="ts">
import { useTemplateRef } from "vue";

import { isReaderRoute } from "./utils/appNavigation";

const route = useRoute();
const navigationDrawer = useTemplateRef<HTMLDialogElement>("navigation-drawer");
const isNavigationOpen = ref(false);
const { session, signOut } = useBookAuth();
const hasSession = computed(() => Boolean(session.value.data?.user));
const userLabel = computed(
  () =>
    session.value.data?.user.name ??
    session.value.data?.user.email ??
    "Signed in"
);
const isReader = computed(() => isReaderRoute(route.path));

watch(
  () => route.fullPath,
  () => closeNavigation()
);

/** Opens the modal navigation drawer when the persistent sidebar is hidden. */
const openNavigation = (): void => {
  const drawer = navigationDrawer.value;

  if (!drawer || drawer.open) {
    return;
  }

  drawer.showModal();
  isNavigationOpen.value = true;
};

/** Closes the navigation drawer and lets the browser restore trigger focus. */
const closeNavigation = (): void => {
  const drawer = navigationDrawer.value;

  if (drawer?.open) {
    drawer.close();
  }

  isNavigationOpen.value = false;
};

/** Synchronizes reactive drawer state after native Escape dismissal. */
const handleNavigationClosed = (): void => {
  isNavigationOpen.value = false;
};

/** Signs the current user out and moves back to the login screen. */
const submitSignOut = async (): Promise<void> => {
  closeNavigation();
  await signOut();
  await navigateTo("/login");
};
</script>

<template>
  <div class="app-shell" :class="{ 'is-reader': isReader }">
    <a class="skip-link" href="#content">Skip to content</a>

    <header class="topbar">
      <div class="topbar-start">
        <button
          class="menu-trigger"
          type="button"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          aria-controls="navigation-drawer"
          :aria-expanded="isNavigationOpen"
          @click="openNavigation"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <NuxtLink class="brand" to="/">
          <span class="brand-mark" aria-hidden="true">BC</span>
          <span class="brand-copy">
            <strong>BookCafe</strong>
            <small>Personal library</small>
          </span>
        </NuxtLink>
      </div>

      <ClientOnly>
        <div v-if="hasSession" class="account">
          <span class="user">{{ userLabel }}</span>
          <button type="button" @click="submitSignOut">Sign out</button>
        </div>
        <NuxtLink v-else class="session-link" to="/login">Login</NuxtLink>
        <template #fallback>
          <span class="session-placeholder" aria-hidden="true" />
        </template>
      </ClientOnly>
    </header>

    <aside class="sidebar">
      <AppNavigation />
    </aside>

    <main id="content" class="content" tabindex="-1">
      <NuxtPage />
    </main>

    <dialog
      id="navigation-drawer"
      ref="navigation-drawer"
      class="drawer"
      aria-labelledby="navigation-drawer-title"
      @click.self="closeNavigation"
      @close="handleNavigationClosed"
    >
      <div class="drawer-sheet">
        <div class="drawer-header">
          <div>
            <p class="drawer-kicker">Personal library</p>
            <h2 id="navigation-drawer-title">BookCafe</h2>
          </div>
          <button
            class="close-button"
            type="button"
            aria-label="Close navigation"
            @click="closeNavigation"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <AppNavigation @navigate="closeNavigation" />
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.app-shell {
  --app-topbar-height: 4rem;

  display: grid;
  grid-template-areas:
    "topbar topbar"
    "sidebar content";
  grid-template-columns: 16rem minmax(0, 1fr);
  grid-template-rows:
    var(--app-topbar-height)
    minmax(calc(100dvh - var(--app-topbar-height)), auto);
  min-height: 100dvh;
  color: var(--text);
  background: var(--surface);
}

.skip-link {
  position: fixed;
  top: 0.65rem;
  left: 50%;
  z-index: 100;
  padding: 0.65rem 0.9rem;
  border-radius: 6px;
  color: #fff;
  background: var(--accent-strong);
  text-decoration: none;
  transform: translate(-50%, -150%);
}

.skip-link:focus {
  transform: translate(-50%, 0);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  grid-area: topbar;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-width: 0;
  height: var(--app-topbar-height);
  padding: 0.55rem clamp(0.75rem, 2vw, 1.25rem);
  border-bottom: 1px solid var(--line);
  background: color-mix(in oklab, var(--surface) 94%, transparent);
  backdrop-filter: blur(12px);
}

.topbar-start,
.brand,
.account {
  display: flex;
  align-items: center;
}

.topbar-start {
  gap: 0.65rem;
  min-width: 0;
}

.brand {
  gap: 0.65rem;
  min-width: 0;
  color: var(--text);
  text-decoration: none;
}

.brand-mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 2.25rem;
  height: 2.55rem;
  border: 1px solid color-mix(in oklab, var(--accent) 55%, var(--line));
  border-left-width: 0.28rem;
  border-radius: 3px 7px 7px 3px;
  color: var(--accent-strong);
  background: var(--panel);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.brand-copy {
  display: grid;
  line-height: 1.1;
}

.brand-copy strong {
  font-size: 0.98rem;
  font-weight: 750;
  letter-spacing: -0.01em;
}

.brand-copy small {
  margin-top: 0.22rem;
  color: var(--muted);
  font-size: 0.7rem;
}

.menu-trigger,
.close-button {
  display: none;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--text);
  background: var(--panel);
  cursor: pointer;
}

.menu-trigger svg,
.close-button svg {
  width: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.8;
}

.account {
  gap: 0.65rem;
  min-width: 0;
}

.account button,
.session-link {
  flex: 0 0 auto;
  min-height: 2.4rem;
  padding: 0 0.8rem;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--text);
  background: var(--panel);
  font-size: 0.82rem;
  text-decoration: none;
  cursor: pointer;
}

.session-link {
  display: grid;
  place-items: center;
}

.account button:hover,
.session-link:hover {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
}

.user {
  max-width: min(16rem, 30vw);
  overflow: hidden;
  color: var(--muted);
  font-size: 0.82rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-placeholder {
  width: 4.5rem;
  height: 2.4rem;
}

.sidebar {
  position: sticky;
  top: var(--app-topbar-height);
  grid-area: sidebar;
  align-self: start;
  height: calc(100dvh - var(--app-topbar-height));
  padding: 1.15rem 0.75rem 2rem;
  overflow-y: auto;
  border-right: 1px solid var(--line);
  background: color-mix(in oklab, var(--surface) 82%, var(--panel));
}

.content {
  grid-area: content;
  min-width: 0;
  min-height: calc(100dvh - var(--app-topbar-height));
}

.drawer {
  position: fixed;
  inset: 0;
  width: 100vw;
  max-width: none;
  height: 100dvh;
  max-height: none;
  padding: 0;
  border: 0;
  margin: 0;
  overflow: hidden;
  background: transparent;
}

.drawer::backdrop {
  background: rgb(23 23 23 / 46%);
}

.drawer-sheet {
  width: min(20.5rem, calc(100vw - 3rem));
  height: 100%;
  padding: 1rem 0.8rem 2rem;
  overflow-y: auto;
  border-right: 1px solid var(--line);
  background: var(--surface);
  box-shadow: 1rem 0 3rem rgb(23 23 23 / 20%);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.15rem 0.25rem 1.15rem;
  margin-bottom: 1.1rem;
  border-bottom: 1px solid var(--line);
}

.drawer-header h2,
.drawer-kicker {
  margin: 0;
}

.drawer-header h2 {
  font-size: 1.15rem;
}

.drawer-kicker {
  margin-bottom: 0.2rem;
  color: var(--muted);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.drawer .close-button {
  display: grid;
}

.is-reader {
  grid-template-areas:
    "topbar"
    "content";
  grid-template-columns: minmax(0, 1fr);
}

.is-reader .sidebar {
  display: none;
}

.is-reader .menu-trigger {
  display: grid;
}

@media (width <= 760px) {
  .app-shell {
    grid-template-areas:
      "topbar"
      "content";
    grid-template-columns: minmax(0, 1fr);
  }

  .sidebar {
    display: none;
  }

  .menu-trigger {
    display: grid;
  }
}

@media (width <= 480px) {
  .brand-copy small,
  .user {
    display: none;
  }

  .topbar {
    gap: 0.5rem;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .skip-link {
    transition: transform 150ms ease;
  }

  .drawer[open] .drawer-sheet {
    animation: reveal-drawer 180ms ease-out both;
  }

  @keyframes reveal-drawer {
    from {
      transform: translateX(-100%);
    }

    to {
      transform: translateX(0);
    }
  }
}
</style>
