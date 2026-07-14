/**
 * Browser entrypoint for the BookCafe Tauri manager.
 */

import "./styles.css";
import "./manager.css";

import { createApp } from "vue";

import App from "./App.vue";
import { createDesktopManagerController } from "./manager.js";
import { createTauriDesktopRuntime } from "./runtime.js";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("BookCafe manager root element was not found.");
}

const controller = createDesktopManagerController({
  runtime: createTauriDesktopRuntime()
});

createApp(App, { controller }).mount(root);
