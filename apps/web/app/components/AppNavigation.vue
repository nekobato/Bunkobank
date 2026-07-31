<script setup lang="ts">
import {
  appNavigationItems,
  isAppNavigationItemActive,
  type AppNavigationItem
} from "../utils/appNavigation";

const emit = defineEmits<{
  navigate: [];
}>();
const { dark = false } = defineProps<{ dark?: boolean }>();

const route = useRoute();
const hasHydrated = ref(false);
const browseItems = appNavigationItems.filter(
  ({ group }) => group === "browse"
);
const manageItems = appNavigationItems.filter(
  ({ group }) => group === "manage"
);
const currentHash = computed(() => (hasHydrated.value ? route.hash : ""));
const currentFullPath = computed(() =>
  hasHydrated.value ? route.fullPath : route.path
);

onMounted(() => {
  hasHydrated.value = true;
});

/** Returns whether the destination represents the current route location. */
const isActive = (item: AppNavigationItem): boolean =>
  isAppNavigationItemActive(item, route.path, currentHash.value);

/** Returns the appropriate ARIA current value for a selected destination. */
const getAriaCurrent = (
  item: AppNavigationItem
): "page" | "location" | undefined => {
  if (!isActive(item)) {
    return undefined;
  }

  return currentFullPath.value === item.to ? "page" : "location";
};
</script>

<template>
  <nav
    class="navigation"
    :class="{ 'is-dark': dark }"
    aria-label="主要ナビゲーション"
  >
    <div class="group">
      <p class="group-label">読む</p>
      <ul class="link-list">
        <li v-for="item in browseItems" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="nav-link"
            :class="{ 'is-active': isActive(item) }"
            :aria-current="getAriaCurrent(item)"
            @click="emit('navigate')"
          >
            <span class="spine" aria-hidden="true" />
            <strong>{{ item.label }}</strong>
          </NuxtLink>
        </li>
      </ul>
    </div>

    <div class="group">
      <p class="group-label">管理</p>
      <ul class="link-list">
        <li v-for="item in manageItems" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="nav-link"
            :class="{ 'is-active': isActive(item) }"
            :aria-current="getAriaCurrent(item)"
            @click="emit('navigate')"
          >
            <span class="spine" aria-hidden="true" />
            <strong>{{ item.label }}</strong>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </nav>
</template>

<style scoped>
.navigation {
  display: grid;
  align-content: start;
  gap: 1.5rem;
}

.navigation.is-dark {
  --muted: rgb(247 249 248 / 68%);
  --text: #f7f9f8;
  --line: rgb(255 255 255 / 18%);
  --panel: rgb(255 255 255 / 10%);
  --accent: #aebcff;
}

.group {
  display: grid;
  gap: 0.45rem;
}

.group-label {
  margin: 0 0 0 0.85rem;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.link-list {
  display: grid;
  gap: 0.15rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.nav-link {
  position: relative;
  display: grid;
  grid-template-columns: 0.35rem minmax(0, 1fr);
  gap: 0.7rem;
  align-items: center;
  min-height: 3rem;
  padding: 0.6rem 0.75rem 0.6rem 0.55rem;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--muted);
  text-decoration: none;
}

.nav-link:hover {
  border-color: color-mix(in oklab, var(--line) 75%, transparent);
  color: var(--text);
  background: color-mix(in oklab, var(--panel) 68%, transparent);
}

.nav-link.is-active {
  border-color: var(--line);
  color: var(--text);
  background: rgb(255 255 255 / 12%);
  box-shadow: 0 0.25rem 1rem rgb(36 30 20 / 5%);
}

.spine {
  position: relative;
  width: 0.25rem;
  height: 2rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--line) 75%, var(--muted));
}

.spine::after {
  position: absolute;
  top: 0.35rem;
  right: -0.16rem;
  width: 0.16rem;
  height: 1.3rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--line) 80%, transparent);
  content: "";
}

.is-active .spine {
  background: var(--accent);
}

.is-active .spine::after {
  background: color-mix(in oklab, var(--accent) 45%, var(--line));
}

.nav-link strong {
  color: inherit;
  font-size: 0.94rem;
  font-weight: 650;
}

@media (prefers-reduced-motion: no-preference) {
  .nav-link,
  .spine,
  .spine::after {
    transition:
      color 150ms ease,
      border-color 150ms ease,
      background-color 150ms ease,
      box-shadow 150ms ease;
  }
}
</style>
