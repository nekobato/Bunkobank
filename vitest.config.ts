import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@bookcafe/config/shared",
        replacement: fileURLToPath(
          new URL("./packages/config/src/shared.ts", import.meta.url)
        )
      },
      {
        find: "@bookcafe/config",
        replacement: fileURLToPath(
        new URL("./packages/config/src/index.ts", import.meta.url)
        )
      },
      ...[
        ["@bookcafe/contracts", "./packages/contracts/src/index.ts"],
        ["@bookcafe/core", "./packages/core/src/index.ts"],
        ["@bookcafe/db", "./packages/db/src/index.ts"],
        [
          "@bookcafe/format-adapters",
          "./packages/format-adapters/src/index.ts"
        ],
        ["@bookcafe/scanner", "./packages/scanner/src/index.ts"]
      ].map(([find, path]) => ({
        find,
        replacement: fileURLToPath(new URL(path, import.meta.url))
      }))
    ]
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
