/** Desktop UI copy contract for the minimal server monitor. */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const renderedDesktopUiSource = [
  "./App.vue",
  "./components/DesktopStatusRail.vue"
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");
const desktopUiSource = [
  renderedDesktopUiSource,
  readFileSync(new URL("./presentation.ts", import.meta.url), "utf8")
].join("\n");

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
  "Web UIを開く",
  "アカウント、ライブラリ、ネットワーク、サムネイルの設定はWeb UIで行います。",
  "外部で起動したBookCafeは、このアプリから停止できません。"
] as const;

const removedSettingControls = [
  "DesktopSetupPanel",
  "DesktopNetworkPanel",
  "DesktopStartupPanel",
  "ポートを保存",
  "自動起動"
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

  it.each(removedSettingControls)(
    "does not render a duplicated setting control: %s",
    (copy) => {
      expect(renderedDesktopUiSource).not.toContain(copy);
    }
  );
});
