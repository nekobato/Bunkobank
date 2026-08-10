/**
 * Browser entrypoint for the Bunkobank Tauri manager.
 */

import "element-plus/dist/index.css";
import "@bunkobank/ui/styles.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./styles.css";

import ElementPlus from "element-plus";
import ja from "element-plus/es/locale/lang/ja";
import "dayjs/locale/ja";
import { createApp } from "vue";

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

const systemDarkMode = window.matchMedia("(prefers-color-scheme: dark)");
const syncSystemColorScheme = (
  preference: MediaQueryList | MediaQueryListEvent
): void => {
  document.documentElement.classList.toggle("dark", preference.matches);
};

syncSystemColorScheme(systemDarkMode);
systemDarkMode.addEventListener("change", syncSystemColorScheme);

app.use(ElementPlus, { locale: ja });

app.mount(root);
