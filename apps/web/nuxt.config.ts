export default defineNuxtConfig({
  app: {
    head: {
      title: "BookCafe",
      htmlAttrs: {
        lang: "en"
      }
    }
  },
  compatibilityDate: "2026-07-09",
  css: ["~/assets/css/base.css"],
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
