<script setup lang="ts">
/**
 * User-owned manual collections for the selected library.
 *
 * @module
 */

import type { CollectionResponse } from "@bunkobank/contracts";

import { getApiErrorMessage } from "../../utils/apiErrors";

useHead({ title: "コレクション" });

const {
  createCollection,
  deleteCollection,
  listCollections,
  updateCollection
} = useBookApi();
const {
  error: libraryError,
  loaded: librariesLoaded,
  loading: librariesLoading,
  refreshLibraries,
  selectedLibrary,
  selectedLibraryId
} = useLibraries();
const newName = ref("");
const collectionToRename = ref<CollectionResponse | null>(null);
const collectionToDelete = ref<CollectionResponse | null>(null);
const renameDraft = ref("");
const isCreating = ref(false);
const isRenaming = ref(false);
const isDeleting = ref(false);
const operationMessage = ref("");
const operationSeverity = ref<"success" | "error">("success");
const { data, error, pending, refresh } = await useAsyncData(
  "selected-library-collections",
  () =>
    selectedLibraryId.value
      ? listCollections(selectedLibraryId.value)
      : Promise.resolve({ collections: [] }),
  {
    default: () => ({ collections: [] }),
    server: false,
    watch: [selectedLibraryId]
  }
);
const collections = computed(() => data.value?.collections ?? []);
const libraryErrorMessage = computed(() =>
  getApiErrorMessage(libraryError.value, "ライブラリを読み込めませんでした。")
);
const errorMessage = computed(() =>
  getApiErrorMessage(error.value, "コレクションを読み込めませんでした。")
);

watch(selectedLibraryId, () => {
  newName.value = "";
  collectionToRename.value = null;
  collectionToDelete.value = null;
  operationMessage.value = "";
});

/**
 * Creates one collection in the currently selected library.
 */
const submitCreate = async (): Promise<void> => {
  const libraryId = selectedLibraryId.value;
  const name = newName.value.trim();

  if (!libraryId || !name) {
    return;
  }

  isCreating.value = true;
  operationMessage.value = "";

  try {
    await createCollection(libraryId, { name });
    newName.value = "";
    await refresh();
    operationSeverity.value = "success";
    operationMessage.value = "コレクションを作成しました。";
  } catch (cause) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      cause,
      "コレクションを作成できませんでした。"
    );
  } finally {
    isCreating.value = false;
  }
};

/**
 * Opens the rename dialog with the current collection name.
 */
const openRenameDialog = (collection: CollectionResponse): void => {
  collectionToRename.value = collection;
  renameDraft.value = collection.name;
};

/**
 * Persists one collection name.
 */
const submitRename = async (): Promise<void> => {
  const libraryId = selectedLibraryId.value;
  const collection = collectionToRename.value;
  const name = renameDraft.value.trim();

  if (!libraryId || !collection || !name) {
    return;
  }

  isRenaming.value = true;
  operationMessage.value = "";

  try {
    await updateCollection(libraryId, collection.id, { name });
    collectionToRename.value = null;
    await refresh();
    operationSeverity.value = "success";
    operationMessage.value = "コレクション名を変更しました。";
  } catch (cause) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      cause,
      "コレクション名を変更できませんでした。"
    );
  } finally {
    isRenaming.value = false;
  }
};

/**
 * Deletes only the collection and its memberships.
 */
const confirmDelete = async (): Promise<void> => {
  const libraryId = selectedLibraryId.value;
  const collection = collectionToDelete.value;

  if (!libraryId || !collection) {
    return;
  }

  isDeleting.value = true;
  operationMessage.value = "";

  try {
    await deleteCollection(libraryId, collection.id);
    collectionToDelete.value = null;
    await refresh();
    operationSeverity.value = "success";
    operationMessage.value = "コレクションを削除しました。";
  } catch (cause) {
    operationSeverity.value = "error";
    operationMessage.value = getApiErrorMessage(
      cause,
      "コレクションを削除できませんでした。"
    );
  } finally {
    isDeleting.value = false;
  }
};
</script>

<template>
  <section class="collections">
    <header class="heading">
      <div>
        <p v-if="selectedLibrary" class="page-eyebrow">
          {{ selectedLibrary.name }}
        </p>
        <h1 class="page-title">コレクション</h1>
      </div>
      <ElButton
        :icon="ElIconRefresh"
        type="info"
        plain
        :disabled="!selectedLibraryId"
        @click="() => refresh()"
      >
        更新
      </ElButton>
    </header>

    <ElAlert
      v-if="operationMessage"
      :type="operationSeverity"
      :closable="false"
      show-icon
    >
      {{ operationMessage }}
    </ElAlert>

    <ClientOnly>
      <div
        v-if="librariesLoading || (!librariesLoaded && pending)"
        class="status"
        role="status"
      >
        <LoadingIndicator class="spinner" />
      </div>
      <ElAlert
        v-else-if="libraryError"
        type="error"
        :closable="false"
        show-icon
      >
        <span>{{ libraryErrorMessage }}</span>
        <ElButton :icon="ElIconRefresh" size="small" @click="refreshLibraries">
          再試行
        </ElButton>
      </ElAlert>
      <ElCard v-else-if="!selectedLibraryId" class="empty-card">
        <template #default>
          <p>ライブラリは未登録です。</p>
          <NuxtLink class="button-link" to="/setup">
            <ElButton :icon="ElIconSetting">設定を開く</ElButton>
          </NuxtLink>
        </template>
      </ElCard>
      <template v-else>
        <ElCard class="create-card">
          <template #header>新しいコレクション</template>
          <template #default>
            <form class="create-form" @submit.prevent="submitCreate">
              <div class="name-field">
                <label for="collection-name">名前</label>
                <ElInput
                  id="collection-name"
                  v-model="newName"
                  name="name"
                  maxlength="100"
                  autocomplete="off"
                  placeholder="例: 今月読む本"
                  required
                  class="fluid-control"
                />
              </div>
              <ElButton
                :icon="ElIconPlus"
                native-type="submit"
                :loading="isCreating"
                :disabled="!newName.trim()"
              >
                作成
              </ElButton>
            </form>
          </template>
        </ElCard>

        <div v-if="pending" class="status" role="status">
          <LoadingIndicator class="spinner" />
        </div>
        <ElAlert v-else-if="error" type="error" :closable="false" show-icon>
          {{ errorMessage }}
        </ElAlert>
        <ul v-else-if="collections.length > 0" class="collection-list">
          <li
            v-for="collection in collections"
            :key="collection.id"
            class="collection-item status-spine tone-info"
          >
            <NuxtLink
              class="collection-link"
              :to="`/collections/${collection.id}`"
            >
              <span>
                <strong>{{ collection.name }}</strong>
                <small>{{ collection.bookCount }}冊</small>
              </span>
              <ElIcon aria-hidden="true"><ElIconArrowRight /></ElIcon>
            </NuxtLink>
            <div class="item-actions">
              <ElButton
                :icon="ElIconEdit"
                size="small"
                type="info"
                text
                @click="openRenameDialog(collection)"
              >
                名前を変更
              </ElButton>
              <ElButton
                :icon="ElIconDelete"
                size="small"
                type="danger"
                text
                @click="collectionToDelete = collection"
              >
                削除
              </ElButton>
            </div>
          </li>
        </ul>
        <ElCard v-else class="empty-card">
          <template #default>
            <ElIcon aria-hidden="true"><ElIconList /></ElIcon>
            <p>コレクションはありません。</p>
          </template>
        </ElCard>
      </template>
    </ClientOnly>

    <ElDialog
      :model-value="collectionToRename !== null"
      title="コレクション名を変更"
      width="min(28rem, calc(100vw - 2rem))"
      @update:model-value="collectionToRename = null"
    >
      <form id="rename-collection-form" @submit.prevent="submitRename">
        <div class="name-field">
          <label for="rename-collection">名前</label>
          <ElInput
            id="rename-collection"
            v-model="renameDraft"
            maxlength="100"
            autocomplete="off"
            required
            class="fluid-control"
          />
        </div>
      </form>
      <template #footer>
        <ElButton type="info" text @click="collectionToRename = null">
          キャンセル
        </ElButton>
        <ElButton
          form="rename-collection-form"
          :icon="ElIconCheck"
          native-type="submit"
          :loading="isRenaming"
          :disabled="!renameDraft.trim()"
        >
          保存
        </ElButton>
      </template>
    </ElDialog>

    <ElDialog
      :model-value="collectionToDelete !== null"
      title="コレクションを削除"
      width="min(28rem, calc(100vw - 2rem))"
      @update:model-value="collectionToDelete = null"
    >
      <p class="dialog-copy">
        「{{ collectionToDelete?.name }}」を削除します。本は削除されません。
      </p>
      <template #footer>
        <ElButton type="info" text @click="collectionToDelete = null">
          キャンセル
        </ElButton>
        <ElButton
          :icon="ElIconDelete"
          type="danger"
          :loading="isDeleting"
          @click="confirmDelete"
        >
          削除
        </ElButton>
      </template>
    </ElDialog>
  </section>
</template>

<style scoped>
.collections {
  display: grid;
  gap: 1.4rem;
  inline-size: min(68rem, 100%);
  padding: clamp(1.25rem, 4vw, 3.5rem);
  margin: 0 auto;
}

.heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
}

.heading h1,
.page-eyebrow,
.dialog-copy {
  margin: 0;
}

.create-card {
  border-inline-start: 0.35rem solid var(--bc-ink-blue);
}

.button-link {
  text-decoration: none;
}

.create-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 0.75rem;
}

.name-field {
  display: grid;
  gap: 0.38rem;
}

.name-field label {
  color: var(--bc-ink-soft);
  font-size: 0.78rem;
  font-weight: 700;
}

.collection-list {
  display: grid;
  gap: 0.75rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.collection-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  border: 1px solid var(--bc-line-soft);
  border-radius: 0.85rem;
  background: var(--bc-panel);
  padding: 0.8rem 1rem 0.8rem 1.25rem;
  box-shadow: var(--bc-shadow-low);
}

.collection-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-inline-size: 0;
  color: var(--bc-ink);
  text-decoration: none;
}

.collection-link span {
  display: grid;
  gap: 0.2rem;
  min-inline-size: 0;
}

.collection-link strong {
  overflow-wrap: anywhere;
}

.collection-link small {
  color: var(--bc-ink-soft);
}

.collection-link:hover strong {
  text-decoration: underline;
}

.item-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 0.25rem;
}

.status {
  display: grid;
  min-block-size: 8rem;
  place-items: center;
}

.spinner {
  inline-size: 2rem;
  block-size: 2rem;
}

.empty-card {
  text-align: center;
}

.empty-card :deep(.el-card__body) {
  display: grid;
  justify-items: center;
  gap: 0.85rem;
  padding-block: 2.5rem;
}

.empty-card p {
  margin: 0;
  color: var(--bc-ink-soft);
}

@media (width <= 44rem) {
  .heading,
  .collection-item {
    align-items: start;
    grid-template-columns: minmax(0, 1fr);
  }

  .heading {
    flex-direction: column;
  }

  .create-form {
    grid-template-columns: minmax(0, 1fr);
  }

  .item-actions {
    justify-content: start;
  }
}
</style>
