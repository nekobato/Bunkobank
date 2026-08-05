/**
 * Browser entrypoint for the Bunkobank Tauri manager.
 */

import "primeicons/primeicons.css";
import "@bunkobank/ui/styles.css";
import "./styles.css";

import { desktopShelfmarkTheme, shelfmarkJapaneseLocale } from "@bunkobank/ui";
import PrimeVue from "primevue/config";
import { createApp, type Plugin } from "vue";

import App from "./App.vue";
import { createDesktopManagerController } from "./manager.js";
import { createTauriDesktopRuntime } from "./runtime.js";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Bunkobank manager root element was not found.");
}

const controller = createDesktopManagerController({
  runtime: createTauriDesktopRuntime()
});

const app = createApp(App, { controller });

// PrimeVue's package-level re-export loses its default Plugin type under
// NodeNext, although the runtime default is the documented Vue plugin.
app.use(PrimeVue as unknown as Plugin, {
  theme: desktopShelfmarkTheme,
  ripple: true,
  locale: shelfmarkJapaneseLocale
});

app.mount(root);
