/** Web UI copy contract for concise application screens. */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const webUiSource = [
  "./app.vue",
  "./components/AppNavigation.vue",
  "./components/BookList.vue",
  "./components/LibraryManager.vue",
  "./components/ReaderToolbar.vue",
  "./components/ReaderView.vue",
  "./pages/books/[bookId]/index.vue",
  "./pages/books/[bookId]/read.vue",
  "./pages/collections/[collectionId].vue",
  "./pages/collections/index.vue",
  "./pages/index.vue",
  "./pages/login.vue",
  "./pages/setup.vue",
  "./utils/appNavigation.ts"
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

const promotionalOrRedundantCopy = [
  "わたしの書棚",
  "読みたい一冊を探し、前回の続きから静かに開けます。",
  "おかえりなさい",
  "書棚へログイン",
  "BookCafeのローカルアカウントを入力してください。",
  "蔵書フォルダーを登録し、元ファイルの変更をライブラリへ反映します。",
  "アカウント、接続、保存場所とスキャンを管理します。",
  "初期設定は完了しています",
  "以後の変更は下の各項目から行えます。",
  "蔵書を探して読む",
  "フォルダーとスキャンを管理",
  "処理の進捗と結果を確認",
  "接続と保存場所を構成"
] as const;

const requiredOperationalCopy = [
  "設定を確認できません",
  "再試行",
  "すべてのネットワークインターフェースで待ち受けます。ファイアウォールを確認してください。",
  "元ファイルからこのページ画像を読み取れませんでした。",
  "保存していない書誌情報があります。"
] as const;

describe("web UI copy", () => {
  it.each(promotionalOrRedundantCopy)(
    "does not render promotional or redundant copy: %s",
    (copy) => {
      expect(webUiSource).not.toContain(copy);
    }
  );

  it.each(requiredOperationalCopy)(
    "retains operational or safety copy: %s",
    (copy) => {
      expect(webUiSource).toContain(copy);
    }
  );
});
