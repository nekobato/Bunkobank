import { shelfmarkJapaneseLocale, webShelfmarkTheme } from "@bookcafe/ui";

export default defineNuxtConfig({
  app: {
    head: {
      title: "BookCafe",
      meta: [{ name: "theme-color", content: "#EEF2F2" }],
      htmlAttrs: {
        lang: "ja"
      }
    }
  },
  compatibilityDate: "2026-07-09",
  modules: ["@primevue/nuxt-module"],
  css: [
    "primeicons/primeicons.css",
    "@bookcafe/ui/styles.css",
    "~/assets/css/base.css"
  ],
  primevue: {
    autoImport: true,
    options: {
      ripple: true,
      theme: webShelfmarkTheme,
      locale: shelfmarkJapaneseLocale
    }
  },
  runtimeConfig: {
    public: {
      apiBase:
        process.env.NUXT_PUBLIC_API_BASE ??
        (process.env.NODE_ENV === "development"
          ? "http://127.0.0.1:4510/api"
          : "/api")
    }
  },
  typescript: {
    strict: true,
    typeCheck: true
  }
});
