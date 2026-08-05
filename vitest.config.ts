import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@bunkobank/config/shared",
        replacement: fileURLToPath(
          new URL("./packages/config/src/shared.ts", import.meta.url)
        )
      },
      {
        find: "@bunkobank/config",
        replacement: fileURLToPath(
          new URL("./packages/config/src/index.ts", import.meta.url)
        )
      },
      ...[
        ["@bunkobank/contracts", "./packages/contracts/src/index.ts"],
        ["@bunkobank/core", "./packages/core/src/index.ts"],
        ["@bunkobank/db", "./packages/db/src/library.ts"],
        [
          "@bunkobank/format-adapters",
          "./packages/format-adapters/src/index.ts"
        ],
        ["@bunkobank/scanner", "./packages/scanner/src/index.ts"]
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
      "**/.sidecar-stage/**",
      "**/apps/server/public/**"
    ]
  }
});
