<script setup lang="ts">
import type { LibraryResponse } from "@bunkobank/contracts";

const {
  hasSession,
  libraries,
  librariesLoading,
  libraryPlaceholder,
  selectedLibraryId,
  userLabel
} = defineProps<{
  hasSession: boolean;
  libraries: LibraryResponse[];
  librariesLoading: boolean;
  libraryPlaceholder: string;
  selectedLibraryId: string | null;
  userLabel: string;
}>();
const emit = defineEmits<{
  navigate: [];
  signOut: [];
  updateLibrary: [libraryId: string | null];
}>();
const libraryInputId = useId();
const libraryLabelId = `${libraryInputId}-label`;

/** Forwards a library selection to the application shell. */
const updateLibrary = (libraryId: string | null): void => {
  emit("updateLibrary", libraryId);
};
</script>

<template>
  <div class="sidebar-panel">
    <NuxtLink class="brand" to="/" @click="emit('navigate')">
      <span class="brand-mark" aria-hidden="true">BB</span>
      <span class="brand-copy" translate="no">
        <strong>Bunkobank</strong>
        <small>Web Library</small>
      </span>
    </NuxtLink>

    <ClientOnly>
      <section
        v-if="hasSession"
        class="library-picker"
        :aria-labelledby="libraryLabelId"
      >
        <label :id="libraryLabelId" class="control-label" :for="libraryInputId">
          ライブラリ
        </label>
        <ElSelect
          :id="libraryInputId"
          :model-value="selectedLibraryId"
          :placeholder="libraryPlaceholder"
          :loading="librariesLoading"
          :disabled="libraries.length === 0"
          :aria-labelledby="libraryLabelId"
          @update:model-value="updateLibrary"
        >
          <ElOption
            v-for="library in libraries"
            :key="library.id"
            :label="library.name"
            :value="library.id"
          />
        </ElSelect>
      </section>
      <template #fallback>
        <span class="library-placeholder" aria-hidden="true" />
      </template>
    </ClientOnly>

    <AppNavigation class="navigation" dark @navigate="emit('navigate')" />

    <ClientOnly>
      <section v-if="hasSession" class="account" aria-label="アカウント">
        <span class="avatar" aria-hidden="true">
          {{ userLabel.slice(0, 1).toUpperCase() }}
        </span>
        <span class="user" :title="userLabel">{{ userLabel }}</span>
        <ElButton
          class="logout-button"
          :icon="ElIconSwitchButton"
          type="info"
          text
          circle
          aria-label="ログアウト"
          title="ログアウト"
          @click="emit('signOut')"
        />
      </section>
      <NuxtLink v-else class="login-link" to="/login" @click="emit('navigate')">
        <ElButton class="login-button" :icon="ElIconRight">ログイン</ElButton>
      </NuxtLink>
      <template #fallback>
        <span class="session-placeholder" aria-hidden="true" />
      </template>
    </ClientOnly>
  </div>
</template>

<style scoped>
.sidebar-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-block-size: 100%;
  padding: 1.1rem 0.85rem 1rem;
  background: var(--bc-deep-shelf);
  color: #f7f9f8;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-inline-size: 0;
  color: #f7f9f8;
  text-decoration: none;
}

.brand-mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  inline-size: 2.45rem;
  block-size: 3rem;
  border-radius: 0.25rem 0.75rem 0.75rem 0.25rem;
  background: #d9ddff;
  color: var(--bc-deep-shelf);
  font-family: var(--bc-font-display);
  font-size: 0.7rem;
  font-weight: 850;
  box-shadow: inset 0.28rem 0 rgb(49 89 168 / 24%);
}

.brand-copy {
  display: grid;
  min-inline-size: 0;
  line-height: 1.05;
}

.brand-copy strong {
  font-family: var(--bc-font-display);
  font-size: 1rem;
}

.brand-copy small {
  margin-block-start: 0.28rem;
  color: rgb(247 249 248 / 58%);
  font-family: var(--bc-font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.library-picker {
  display: grid;
  gap: 0.4rem;
  padding: 0.8rem;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 0.75rem;
  background: rgb(255 255 255 / 6%);
}

.control-label {
  color: rgb(247 249 248 / 68%);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.library-picker :deep(.el-select) {
  inline-size: 100%;
  min-inline-size: 0;
}

.library-picker :deep(.el-select__wrapper) {
  border-color: rgb(255 255 255 / 20%);
  background: rgb(255 255 255 / 9%);
}

.library-picker :deep(.el-select__selected-item),
.library-picker :deep(.el-select__caret) {
  color: #f7f9f8;
}

.library-placeholder {
  block-size: 4.8rem;
}

.navigation {
  flex: 1 0 auto;
}

.account {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) 2.5rem;
  align-items: center;
  gap: 0.55rem;
  margin-block-start: auto;
  padding: 0.65rem 0.5rem;
  border-block-start: 1px solid rgb(255 255 255 / 14%);
}

.avatar {
  display: grid;
  place-items: center;
  inline-size: 2rem;
  block-size: 2rem;
  border-radius: 50%;
  background: #d9ddff;
  color: var(--bc-deep-shelf);
  font-family: var(--bc-font-display);
  font-size: 0.72rem;
  font-weight: 800;
}

.user {
  min-inline-size: 0;
  overflow: hidden;
  color: rgb(247 249 248 / 78%);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logout-button {
  color: #f7f9f8;
}

.logout-button:hover {
  background: rgb(255 255 255 / 10%);
}

.login-button {
  inline-size: 100%;
}

.login-link {
  text-decoration: none;
}

.session-placeholder {
  block-size: 2.5rem;
}
</style>
