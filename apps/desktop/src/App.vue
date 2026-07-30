<script setup lang="ts">
/** Minimal server monitor shell for the BookCafe desktop application. */

import { computed, onMounted, onUnmounted, shallowRef } from "vue";

import DesktopStatusRail from "./components/DesktopStatusRail.vue";
import type {
  DesktopManagerController,
  DesktopManagerState
} from "./manager.js";
import {
  getServerPresentation,
  localizeDesktopMessage
} from "./presentation.js";

const monitorIntervalMilliseconds = 5_000;
const { controller } = defineProps<{ controller: DesktopManagerController }>();
const state = shallowRef<DesktopManagerState>(controller.getState());
let unsubscribe: (() => void) | undefined;
let monitorInterval: number | undefined;
let activeRefresh: Promise<void> | null = null;

const serverPresentation = computed(() =>
  getServerPresentation(
    state.value.server.phase,
    state.value.server.managedByDesktop
  )
);
const endpoint = computed(() => {
  const { host, port } = state.value.activeConfig;
  return `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/`;
});
const localizedError = computed(() =>
  localizeDesktopMessage(state.value.error)
);
const localizedProcessMessage = computed(() =>
  localizeDesktopMessage(state.value.processMessage)
);

/** Coalesces manual refresh requests to one active server probe. */
const refreshServer = (silent = false): Promise<void> => {
  if (activeRefresh) {
    return activeRefresh;
  }

  activeRefresh = controller
    .refreshServer({ silent })
    .finally(() => (activeRefresh = null));
  return activeRefresh;
};

/** Refreshes in the background only while the monitor is visible and idle. */
const refreshVisibleMonitor = (): void => {
  const isBusy = ["checking", "starting", "stopping"].includes(
    state.value.server.phase
  );

  if (
    document.visibilityState === "visible" &&
    state.value.phase === "ready" &&
    !isBusy
  ) {
    void refreshServer(true);
  }
};

onMounted(() => {
  unsubscribe = controller.subscribe((nextState) => {
    state.value = nextState;
  });
  document.addEventListener("visibilitychange", refreshVisibleMonitor);
  monitorInterval = window.setInterval(
    refreshVisibleMonitor,
    monitorIntervalMilliseconds
  );
  void controller.initialize();
});

onUnmounted(() => {
  unsubscribe?.();
  document.removeEventListener("visibilitychange", refreshVisibleMonitor);

  if (monitorInterval !== undefined) {
    window.clearInterval(monitorInterval);
  }
});
</script>

<template>
  <div class="desktop-app" :aria-busy="state.phase === 'booting'">
    <a class="skip-link" href="#server-monitor">サーバー状態へ移動</a>

    <DesktopStatusRail
      :state="state"
      :endpoint="endpoint"
      :presentation="serverPresentation"
      :process-message="localizedProcessMessage"
      :error-message="localizedError"
      @start="controller.startServer()"
      @stop="controller.stopServer()"
      @open="controller.openWebUi()"
      @refresh="refreshServer()"
    />
  </div>
</template>
