<script setup lang="ts">
/** PrimeVue root shell for the BookCafe Desktop Manager. */

import Message from "primevue/message";
import { computed, nextTick, onMounted, onUnmounted, shallowRef } from "vue";

import DesktopSetupPanel from "./components/DesktopSetupPanel.vue";
import DesktopStartupPanel from "./components/DesktopStartupPanel.vue";
import DesktopStatusRail from "./components/DesktopStatusRail.vue";
import type {
  DesktopManagerController,
  DesktopManagerState
} from "./manager.js";
import {
  getServerPresentation,
  localizeDesktopFieldError,
  localizeDesktopMessage
} from "./presentation.js";

const { controller } = defineProps<{ controller: DesktopManagerController }>();
const state = shallowRef<DesktopManagerState>(controller.getState());
let unsubscribe: (() => void) | undefined;
let previousErrorKey = "";

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
const errorMessages = computed(() => {
  const messages = [
    localizeDesktopMessage(state.value.error),
    ...Object.entries(state.value.setup.fieldErrors).map(([field, message]) =>
      localizeDesktopFieldError(field, message)
    )
  ].filter(Boolean);

  return [...new Set(messages)];
});
const localizedProcessMessage = computed(() =>
  localizeDesktopMessage(state.value.processMessage)
);

/** Moves focus to the newly populated error summary. */
const focusErrorSummary = async (): Promise<void> => {
  await nextTick();
  document.querySelector<HTMLElement>("#desktop-errors")?.focus();
};

/** Persists the current setup draft and exposes server-side errors. */
const submitSetup = async (): Promise<void> => {
  if (!(await controller.submitSetup(controller.getState().draft))) {
    await focusErrorSummary();
  }
};

/** Updates one textual setup value without bypassing controller validation. */
const updateText = (
  field: "username" | "password" | "confirmPassword",
  value: string
): void => {
  controller.updateDraft({ [field]: value });
};

onMounted(() => {
  unsubscribe = controller.subscribe((nextState) => {
    state.value = nextState;
    const errorKey = [
      nextState.error,
      ...Object.values(nextState.setup.fieldErrors)
    ]
      .filter(Boolean)
      .join("\0");

    if (errorKey && errorKey !== previousErrorKey) {
      void focusErrorSummary();
    }
    previousErrorKey = errorKey;
  });
  void controller.initialize();
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="desktop-app" :aria-busy="state.phase === 'booting'">
    <a class="skip-link" href="#manager-content">設定へ移動</a>

    <DesktopStatusRail
      :state="state"
      :endpoint="endpoint"
      :presentation="serverPresentation"
      :process-message="localizedProcessMessage"
      @start="controller.startServer()"
      @stop="controller.stopServer()"
      @open="controller.openLibrary()"
      @refresh="controller.refreshServer()"
    />

    <main id="manager-content" class="manager-content" tabindex="-1">
      <header class="page-heading">
        <h1>設定</h1>
      </header>

      <section
        v-if="errorMessages.length"
        id="desktop-errors"
        class="error-summary"
        tabindex="-1"
        aria-label="確認が必要な項目"
      >
        <Message severity="error" :closable="false">
          <ul>
            <li v-for="message in errorMessages" :key="message">
              {{ message }}
            </li>
          </ul>
        </Message>
      </section>

      <div class="panel-stack">
        <DesktopSetupPanel
          :state="state"
          @submit="submitSetup"
          @update-text="updateText"
        />
        <DesktopStartupPanel
          :state="state"
          @change="controller.setStartupEnabled($event)"
        />
      </div>

      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {{ localizeDesktopMessage(state.announcement) }}
      </p>
    </main>
  </div>
</template>
