import { describe, expect, it } from "vitest";

import {
  getServerPresentation,
  getSetupPresentation,
  getStartupPresentation,
  localizeDesktopFieldError,
  localizeDesktopMessage
} from "./presentation.js";

describe("desktop manager presentation", () => {
  it("describes a managed running server in Japanese", () => {
    expect(getServerPresentation("running", true)).toEqual({
      label: "稼働中",
      detail: "",
      tone: "success"
    });
  });

  it("distinguishes an externally managed server", () => {
    expect(getServerPresentation("running", false).detail).toBe(
      "外部で起動したBookCafeは、このアプリから停止できません。"
    );
  });

  it("marks completed setup as successful", () => {
    expect(getSetupPresentation("complete")).toEqual({
      label: "設定済み",
      tone: "success"
    });
  });

  it("marks startup failures as dangerous", () => {
    expect(getStartupPresentation("error")).toEqual({
      label: "確認できません",
      tone: "danger"
    });
  });

  it("translates known controller messages", () => {
    expect(localizeDesktopMessage("Review the highlighted setup fields.")).toBe(
      "入力内容を確認してください。"
    );
    expect(localizeDesktopMessage("Username or password is invalid.")).toBe(
      "ユーザー名またはパスワードが正しくありません。"
    );
  });

  it.each([
    ["Checking the BookCafe server…", "サーバーを確認しています。"],
    ["Starting BookCafe server…", "サーバーを起動しています。"],
    ["BookCafe server is running.", "サーバーを起動しました。"],
    [
      "BookCafe server could not be started.",
      "サーバーを起動できませんでした。"
    ],
    ["Stopping BookCafe server…", "サーバーを停止しています。"],
    ["BookCafe server stopped.", "サーバーを停止しました。"],
    ["Saving BookCafe setup…", "設定を保存しています。"],
    ["BookCafe setup is complete.", "設定を保存しました。"],
    ["Login startup enabled.", "自動起動を有効にしました。"],
    ["Login startup disabled.", "自動起動を無効にしました。"]
  ])("translates the status announcement %s", (message, expected) => {
    expect(localizeDesktopMessage(message)).toBe(expected);
  });

  it("preserves unknown diagnostics after a Japanese label", () => {
    expect(localizeDesktopMessage("sidecar exited with code 1")).toBe(
      "診断情報: sidecar exited with code 1"
    );
  });

  it("presents validation guidance by field instead of leaking schema text", () => {
    expect(
      localizeDesktopFieldError(
        "username",
        "Invalid string: must match pattern"
      )
    ).toBe("ユーザー名は3〜30文字の半角英数字、_、.で入力してください。");
  });
});
