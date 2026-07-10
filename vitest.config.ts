import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@bookcafe/config": fileURLToPath(
        new URL("./packages/config/src/index.ts", import.meta.url)
      ),
      "@bookcafe/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url)
      ),
      "@bookcafe/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url)
      ),
      "@bookcafe/db": fileURLToPath(
        new URL("./packages/db/src/index.ts", import.meta.url)
      ),
      "@bookcafe/format-adapters": fileURLToPath(
        new URL("./packages/format-adapters/src/index.ts", import.meta.url)
      ),
      "@bookcafe/scanner": fileURLToPath(
        new URL("./packages/scanner/src/index.ts", import.meta.url)
      )
    }
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.nuxt/**",
      "**/.output/**",
      "**/apps/server/public/**"
    ]
  }
});
