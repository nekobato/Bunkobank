import { describe, expect, it } from "vitest";

import {
  getBookSourceStatusLabel,
  getBookSourceStatusMessage,
  getBookSourceStatusTitle,
  isReadableBookStatus
} from "./bookAvailability";

describe("book availability", () => {
  it("treats only ready sources as readable", () => {
    expect(isReadableBookStatus("ready")).toBe(true);
    expect(isReadableBookStatus("missing")).toBe(false);
    expect(isReadableBookStatus("error")).toBe(false);
    expect(isReadableBookStatus("scanning")).toBe(false);
  });

  it("formats compact source status labels", () => {
    expect(getBookSourceStatusLabel("ready")).toBe("閲覧可能");
    expect(getBookSourceStatusLabel("scanning")).toBe("スキャン中");
    expect(getBookSourceStatusLabel("missing")).toBe("見つかりません");
    expect(getBookSourceStatusLabel("error")).toBe("エラー");
  });

  it("explains unavailable source states with remediation text", () => {
    expect(getBookSourceStatusTitle("missing")).toBe(
      "元ファイルを確認できません"
    );
    expect(getBookSourceStatusMessage("missing")).toContain("再スキャン");
    expect(getBookSourceStatusTitle("error")).toBe("元ファイルのエラー");
    expect(getBookSourceStatusMessage("error")).toContain("ファイルを確認");
    expect(getBookSourceStatusTitle("scanning")).toBe("スキャン中");
    expect(getBookSourceStatusMessage("scanning")).toContain("完了すると");
  });
});
