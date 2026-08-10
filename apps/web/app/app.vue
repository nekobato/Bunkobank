<script setup lang="ts">
/** Responsive Element Plus application shell for the Bunkobank Web Library. */

import "dayjs/locale/ja";
import ja from "element-plus/es/locale/lang/ja";
import { isReaderRoute } from "./utils/appNavigation";

useHead({
  titleTemplate: (title) => (title ? `Bunkobank - ${title}` : "Bunkobank")
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

/** Persists a library chosen in the application sidebar. */
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
  <ElConfigProvider :locale="ja">
    <div class="app-shell" :class="{ 'is-reader': isReader }">
      <a class="skip-link" href="#content">本文へ移動</a>

      <aside v-if="!isReader" class="sidebar">
        <AppSidebar
          :has-session="hasSession"
          :libraries
          :libraries-loading
          :library-placeholder
          :selected-library-id
          :user-label
          @navigate="isNavigationOpen = false"
          @sign-out="submitSignOut"
          @update-library="updateSelectedLibrary"
        />
      </aside>

      <ElButton
        v-if="!isReader"
        class="menu-trigger"
        :icon="ElIconMenu"
        circle
        aria-label="ナビゲーションを開く"
        aria-controls="navigation-drawer"
        :aria-expanded="isNavigationOpen"
        @click="isNavigationOpen = true"
      />

      <main id="content" class="content" tabindex="-1">
        <NuxtPage />
      </main>

      <ElDrawer
        v-if="!isReader"
        id="navigation-drawer"
        v-model="isNavigationOpen"
        class="navigation-drawer"
        direction="ltr"
        size="16.5rem"
        aria-label="メインナビゲーション"
        @closed="restoreNavigationFocus"
      >
        <AppSidebar
          :has-session="hasSession"
          :libraries
          :libraries-loading
          :library-placeholder
          :selected-library-id
          :user-label
          @navigate="isNavigationOpen = false"
          @sign-out="submitSignOut"
          @update-library="updateSelectedLibrary"
        />
      </ElDrawer>
    </div>
  </ElConfigProvider>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-areas: "sidebar content";
  grid-template-columns: 16.5rem minmax(0, 1fr);
  grid-template-rows: minmax(100dvh, auto);
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

.menu-trigger {
  display: none;
}

.sidebar {
  position: sticky;
  inset-block-start: 0;
  grid-area: sidebar;
  align-self: start;
  block-size: 100dvh;
  overflow-y: auto;
  border-inline-end: 1px solid rgb(255 255 255 / 12%);
  background: var(--bc-deep-shelf);
  scrollbar-gutter: stable;
}

.content {
  grid-area: content;
  min-inline-size: 0;
  min-block-size: 100dvh;
}

.is-reader {
  grid-template-areas: "content";
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(100dvh, auto);
}

@media (width <= 50rem) {
  .app-shell {
    --app-topbar-height: calc(3.75rem + env(safe-area-inset-top));

    grid-template-areas: "content";
    grid-template-columns: minmax(0, 1fr);
  }

  .app-shell:not(.is-reader) .content {
    box-sizing: border-box;
    padding-block-start: var(--app-topbar-height);
  }

  .sidebar {
    display: none;
  }

  .menu-trigger {
    position: fixed;
    z-index: 40;
    inset-block-start: max(0.75rem, env(safe-area-inset-top));
    inset-inline-start: max(0.75rem, env(safe-area-inset-left));
    display: inline-flex;
    border: 1px solid rgb(255 255 255 / 18%);
    background: var(--bc-deep-shelf);
    color: #f7f9f8;
    box-shadow: var(--bc-shadow-medium);
  }
}

:global(.navigation-drawer.el-drawer) {
  border: 0;
  background: var(--bc-deep-shelf);
}

:global(.navigation-drawer .el-drawer__header) {
  position: absolute;
  z-index: 2;
  inset-block-start: 0.7rem;
  inset-inline-end: 0.7rem;
  margin: 0;
  padding: 0;
}

:global(.navigation-drawer .el-drawer__close-btn) {
  color: #f7f9f8;
}

:global(.navigation-drawer .el-drawer__body) {
  padding: 0;
}
</style>
