/** Desktop UI copy contract for the compact manager interface. */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const desktopUiSource = [
  "./App.vue",
  "./components/DesktopSetupPanel.vue",
  "./components/DesktopStartupPanel.vue",
  "./components/DesktopStatusRail.vue",
  "./presentation.ts"
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

const promotionalOrRedundantCopy = [
  "デスクトップマネージャー",
  "ご自身の蔵書を、静かな一つの書棚へ。",
  "BookCafeはこの端末で動作します。",
  "ローカル蔵書マネージャー",
  "蔵書を置く場所とログインを設定",
  "Web版ライブラリへのログインに使います。",
  "個人用のローカル蔵書に適した設定です。",
  "設定はこのユーザーだけに適用され、いつでも元に戻せます。"
] as const;

const requiredOperationalCopy = [
  "8文字以上で入力してください。",
  "データベースを確認できません。",
  "外部で起動したBookCafeは、このアプリから停止できません。"
] as const;

describe("desktop UI copy", () => {
  it.each(promotionalOrRedundantCopy)(
    "does not render promotional or redundant copy: %s",
    (copy) => {
      expect(desktopUiSource).not.toContain(copy);
    }
  );

  it.each(requiredOperationalCopy)(
    "retains operational or safety copy: %s",
    (copy) => {
      expect(desktopUiSource).toContain(copy);
    }
  );
});
