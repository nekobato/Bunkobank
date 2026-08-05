import type { BookStatus } from "@bunkobank/core";

/**
 * Returns whether a book source can currently provide reader pages.
 */
export const isReadableBookStatus = (status: BookStatus): boolean =>
  status === "ready";

/**
 * Formats a book source status for compact UI badges.
 */
export const getBookSourceStatusLabel = (status: BookStatus): string => {
  switch (status) {
    case "error":
      return "エラー";
    case "missing":
      return "見つかりません";
    case "scanning":
      return "スキャン中";
    default:
      return "閲覧可能";
  }
};

/**
 * Returns the short title for a source availability notice.
 */
export const getBookSourceStatusTitle = (status: BookStatus): string => {
  switch (status) {
    case "error":
      return "元ファイルのエラー";
    case "missing":
      return "元ファイルを確認できません";
    case "scanning":
      return "スキャン中";
    default:
      return "閲覧できます";
  }
};

/**
 * Returns the user-facing remediation text for a source availability state.
 */
export const getBookSourceStatusMessage = (status: BookStatus): string => {
  switch (status) {
    case "error":
      return "元ファイルを読み取れませんでした。ファイルを確認してからコレクションを再スキャンしてください。";
    case "missing":
      return "元ファイルを戻してからコレクションを再スキャンしてください。";
    case "scanning":
      return "現在のスキャンが完了すると閲覧できるようになります。";
    default:
      return "この書籍は閲覧できます。";
  }
};
