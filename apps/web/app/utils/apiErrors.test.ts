import { describe, expect, it } from "vitest";

import {
  getApiErrorCode,
  getApiErrorMessage,
  getAccessErrorMessage
} from "./apiErrors";

describe("getApiErrorMessage", () => {
  it("prefers server response messages from fetch errors", () => {
    expect(
      getApiErrorMessage(
        {
          data: {
            message: "Collection root must be a readable directory."
          },
          message: '[POST] "/api/collection-roots": 400 Bad Request'
        },
        "Failed"
      )
    ).toBe("Collection root must be a readable directory.");
  });

  it("falls back to Error messages when the response has no message", () => {
    expect(getApiErrorMessage(new Error("Network failed"), "Failed")).toBe(
      "Network failed"
    );
  });

  it.each([
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource."
  ])(
    "uses the actionable fallback for opaque browser network errors: %s",
    (message) => {
      expect(
        getApiErrorMessage(
          new TypeError(message),
          "サーバーを起動してから再度お試しください。"
        )
      ).toBe("サーバーを起動してから再度お試しください。");
    }
  );

  it("uses the fallback for Nuxt-wrapped network errors", () => {
    expect(
      getApiErrorMessage(
        new TypeError(
          '[GET] "http://127.0.0.1:4510/api/setup/status": <no response> Failed to fetch'
        ),
        "BookCafeへ接続できませんでした。"
      )
    ).toBe("BookCafeへ接続できませんでした。");
  });

  it("returns the fallback for unknown error shapes", () => {
    expect(getApiErrorMessage({ data: {} }, "Failed")).toBe("Failed");
    expect(getApiErrorMessage(null, "Failed")).toBe("Failed");
  });

  it("localizes stable setup error codes", () => {
    const error = {
      data: {
        code: "DATA_UNAVAILABLE",
        message: "BookCafe data is unavailable."
      }
    };

    expect(getApiErrorCode(error)).toBe("DATA_UNAVAILABLE");
    expect(getApiErrorMessage(error, "接続できませんでした。")).toBe(
      "データベースを確認できません。"
    );
  });

  it("does not expose the server's generic internal error copy", () => {
    const error = {
      data: {
        code: "INTERNAL_ERROR",
        message: "Internal server error."
      }
    };

    expect(getApiErrorMessage(error, "接続できませんでした。")).toBe(
      "サーバーエラーが発生しました。"
    );
  });
});

describe("getAccessErrorMessage", () => {
  it("distinguishes incomplete setup from a missing login", () => {
    expect(getAccessErrorMessage(409, "読み込めませんでした。")).toBe(
      "初期設定が必要です。"
    );
    expect(getAccessErrorMessage(401, "読み込めませんでした。")).toBe(
      "ログインが必要です。"
    );
  });

  it("preserves the resource-specific fallback for other failures", () => {
    expect(getAccessErrorMessage(500, "読み込めませんでした。")).toBe(
      "読み込めませんでした。"
    );
  });
});
