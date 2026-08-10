export default defineNuxtConfig({
  app: {
    head: {
      meta: [{ name: "theme-color", content: "#EEF2F2" }],
      htmlAttrs: {
        lang: "ja"
      }
    }
  },
  compatibilityDate: "2026-07-09",
  modules: ["@element-plus/nuxt"],
  css: [
    "element-plus/dist/index.css",
    "@bunkobank/ui/styles.css",
    "~/assets/css/base.css"
  ],
  elementPlus: {
    importStyle: false
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
