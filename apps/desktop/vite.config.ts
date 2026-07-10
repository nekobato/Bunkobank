/**
 * Vite configuration for the Tauri desktop manager WebView.
 */

import { defineConfig } from "vite";

const devHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  server: {
    host: devHost || "127.0.0.1",
    port: 1420,
    strictPort: true,
    hmr: devHost
      ? {
          protocol: "ws",
          host: devHost,
          port: 1421
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows"
        ? "chrome105"
        : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG)
  }
});
