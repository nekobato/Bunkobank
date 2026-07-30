<script setup lang="ts">
/** Responsive PrimeVue application shell for the BookCafe Web Library. */

import { isReaderRoute } from "./utils/appNavigation";

useHead({
  titleTemplate: (title) => (title ? `BookCafe - ${title}` : "BookCafe")
});

const route = useRoute();
const isNavigationOpen = ref(false);
const { session, signOut } = useBookAuth();
const {
  error: libraryError,
  libraries,
  loading: librariesLoading,
  refreshLibraries,
  resetLibraries,
  selectedLibraryId,
  selectLibrary
} = useLibraries();
const hasSession = computed(() => Boolean(session.value.data?.user));
const userLabel = computed(
  () =>
    session.value.data?.user.name ??
    session.value.data?.user.email ??
    "ログイン中"
);
const isReader = computed(() => isReaderRoute(route.path));
const libraryPlaceholder = computed(() =>
  libraryError.value ? "読込エラー" : "未登録"
);

watch(
  hasSession,
  async (authenticated) => {
    if (!authenticated) {
      resetLibraries();
      return;
    }

    try {
      await refreshLibraries();
    } catch {
      // Individual pages expose actionable API errors.
    }
  },
  { immediate: true }
);

watch(
  () => route.fullPath,
  () => {
    isNavigationOpen.value = false;
  }
);

/** Signs out the current user and returns to the login screen. */
const submitSignOut = async (): Promise<void> => {
  isNavigationOpen.value = false;
  await signOut();
  resetLibraries();
  await navigateTo("/login");
};

/** Persists a library chosen in the application header. */
const updateSelectedLibrary = async (
  libraryId: string | null
): Promise<void> => {
  if (libraryId) {
    await selectLibrary(libraryId);
  }
};

/** Restores keyboard focus to the control that opened the navigation drawer. */
const restoreNavigationFocus = (): void => {
  document.querySelector<HTMLButtonElement>(".menu-trigger")?.focus();
};
</script>

<template>
  <div class="app-shell" :class="{ 'is-reader': isReader }">
    <a class="skip-link" href="#content">本文へ移動</a>

    <header class="topbar">
      <div class="topbar-start">
        <Button
          class="menu-trigger"
          icon="pi pi-bars"
          severity="secondary"
          variant="text"
          rounded
          aria-label="ナビゲーションを開く"
          aria-controls="navigation-drawer"
          :aria-expanded="isNavigationOpen"
          @click="isNavigationOpen = true"
        />
        <NuxtLink class="brand" to="/">
          <span class="brand-mark" aria-hidden="true">BC</span>
          <span class="brand-copy" translate="no">
            <strong>BookCafe</strong>
          </span>
        </NuxtLink>
      </div>

      <ClientOnly>
        <div v-if="hasSession" class="library-picker">
          <span id="application-library-label" class="control-label">
            ライブラリ
          </span>
          <Select
            input-id="application-library"
            :model-value="selectedLibraryId"
            :options="libraries"
            option-label="name"
            option-value="id"
            :placeholder="libraryPlaceholder"
            :loading="librariesLoading"
            :disabled="libraries.length === 0"
            aria-labelledby="application-library-label"
            @update:model-value="updateSelectedLibrary"
          />
        </div>
        <template #fallback>
          <span class="library-placeholder" aria-hidden="true" />
        </template>
      </ClientOnly>

      <ClientOnly>
        <div v-if="hasSession" class="account">
          <span class="user">{{ userLabel }}</span>
          <Button
            class="logout-button"
            label="ログアウト"
            icon="pi pi-sign-out"
            severity="secondary"
            variant="outlined"
            size="small"
            aria-label="ログアウト"
            @click="submitSignOut"
          />
        </div>
        <Button
          v-else
          as="router-link"
          label="ログイン"
          icon="pi pi-sign-in"
          to="/login"
          size="small"
        />
        <template #fallback>
          <span class="session-placeholder" aria-hidden="true" />
        </template>
      </ClientOnly>
    </header>

    <aside class="sidebar">
      <AppNavigation dark />
    </aside>

    <main id="content" class="content" tabindex="-1">
      <NuxtPage />
    </main>

    <Drawer
      id="navigation-drawer"
      v-model:visible="isNavigationOpen"
      header="BookCafe"
      aria-label="メインナビゲーション"
      position="left"
      block-scroll
      class="navigation-drawer"
      :close-button-props="{ 'aria-label': '閉じる' }"
      @after-hide="restoreNavigationFocus"
    >
      <AppNavigation @navigate="isNavigationOpen = false" />
    </Drawer>
  </div>
</template>

<style scoped>
.app-shell {
  --app-topbar-height: 4.25rem;

  display: grid;
  grid-template-areas:
    "topbar topbar"
    "sidebar content";
  grid-template-columns: 16.5rem minmax(0, 1fr);
  grid-template-rows: var(--app-topbar-height) minmax(
      calc(100dvh - var(--app-topbar-height)),
      auto
    );
  min-block-size: 100dvh;
  background: var(--bc-fog);
}

.skip-link {
  position: fixed;
  z-index: 1000;
  inset-block-start: 0.65rem;
  inset-inline-start: 50%;
  translate: -50% -170%;
  border-radius: 0.5rem;
  background: var(--bc-deep-shelf);
  color: white;
  padding: 0.65rem 0.9rem;
  font-weight: 750;
  text-decoration: none;
}

.skip-link:focus {
  translate: -50% 0;
}

.topbar {
  position: sticky;
  z-index: 30;
  inset-block-start: 0;
  grid-area: topbar;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-inline-size: 0;
  block-size: var(--app-topbar-height);
  border-block-end: 1px solid var(--bc-line-soft);
  background: color-mix(in oklab, var(--bc-panel) 92%, transparent);
  padding-inline: clamp(0.75rem, 2vw, 1.4rem);
  backdrop-filter: blur(14px);
}

.topbar-start,
.brand,
.account,
.library-picker {
  display: flex;
  align-items: center;
}

.topbar-start {
  gap: 0.6rem;
  min-inline-size: 0;
}

.brand {
  gap: 0.7rem;
  min-inline-size: 0;
  color: var(--bc-ink);
  text-decoration: none;
}

.brand-mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  inline-size: 2.35rem;
  block-size: 2.8rem;
  border-radius: 0.25rem 0.7rem 0.7rem 0.25rem;
  background: #d9ddff;
  color: var(--bc-deep-shelf);
  font-family: var(--bc-font-display);
  font-size: 0.68rem;
  font-weight: 850;
  box-shadow: inset 0.28rem 0 rgb(49 89 168 / 24%);
}

.brand-copy {
  display: grid;
  line-height: 1.1;
}

.brand-copy strong {
  font-family: var(--bc-font-display);
  font-size: 1rem;
}

.user {
  color: var(--bc-ink-soft);
  font-size: 0.72rem;
}

.account {
  gap: 0.7rem;
  min-inline-size: 0;
}

.library-picker {
  gap: 0.55rem;
  min-inline-size: 0;
  margin-inline: auto;
}

.library-picker .control-label {
  color: var(--bc-ink-soft);
  font-size: 0.75rem;
  font-weight: 700;
}

.library-picker :deep(.p-select) {
  inline-size: min(22rem, 30vw);
}

.library-placeholder {
  inline-size: min(22rem, 30vw);
  block-size: 2.5rem;
  margin-inline: auto;
}

.user {
  max-inline-size: min(16rem, 30vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-placeholder {
  inline-size: 5rem;
  block-size: 2.4rem;
}

.menu-trigger {
  display: none;
}

.sidebar {
  position: sticky;
  inset-block-start: var(--app-topbar-height);
  grid-area: sidebar;
  align-self: start;
  block-size: calc(100dvh - var(--app-topbar-height));
  overflow-y: auto;
  border-inline-end: 1px solid rgb(255 255 255 / 12%);
  background: var(--bc-deep-shelf);
  padding: 1.35rem 0.85rem 2rem;
}

.content {
  grid-area: content;
  min-inline-size: 0;
  min-block-size: calc(100dvh - var(--app-topbar-height));
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
  display: inline-flex;
}

@media (width <= 50rem) {
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
    display: inline-flex;
  }
}

@media (width <= 32rem) {
  .topbar {
    gap: 0.5rem;
  }

  .topbar-start {
    flex: 0 0 auto;
    gap: 0.35rem;
  }

  .brand {
    gap: 0;
  }

  .brand-copy {
    display: none;
  }

  .user {
    display: none;
  }

  .account {
    flex: 0 0 auto;
  }

  .logout-button {
    inline-size: 2.5rem;
    padding-inline: 0;
  }

  .logout-button :deep(.p-button-label) {
    display: none;
  }

  .library-picker {
    flex: 1 1 auto;
    margin-inline: 0;
  }

  .library-picker .control-label {
    display: none;
  }

  .library-picker :deep(.p-select) {
    inline-size: 100%;
    min-inline-size: 0;
  }
}
</style>
