/** Pure Japanese presentation models for Desktop Manager lifecycle states. */

import type { ShelfmarkTone } from "@bookcafe/ui";

import type {
  ManagerServerPhase,
  ManagerSetupPhase,
  ManagerStartupPhase
} from "./manager.js";

/** Label, supporting copy, and semantic tone for the server status rail. */
export interface ServerPresentation {
  label: string;
  detail: string;
  tone: ShelfmarkTone;
}

/** Compact lifecycle label and tone for PrimeVue status components. */
export interface PhasePresentation {
  label: string;
  tone: ShelfmarkTone;
}

const serverPresentations = {
  checking: {
    label: "確認中",
    detail: "設定とサーバーを確認しています。",
    tone: "info"
  },
  stopped: {
    label: "停止中",
    detail: "",
    tone: "neutral"
  },
  starting: {
    label: "起動中",
    detail: "",
    tone: "info"
  },
  "port-conflict": {
    label: "ポートを使用できません",
    detail:
      "別のサービスが応答しています。ポートを変更するか、そのサービスを停止してください。",
    tone: "danger"
  },
  unhealthy: {
    label: "確認が必要",
    detail: "診断情報を確認してください。",
    tone: "danger"
  },
  stopping: {
    label: "停止中",
    detail: "",
    tone: "info"
  },
  crashed: {
    label: "予期せず終了",
    detail: "診断情報を確認して再起動してください。",
    tone: "danger"
  }
} as const satisfies Record<
  Exclude<ManagerServerPhase, "running">,
  ServerPresentation
>;

const setupPresentations = {
  unknown: { label: "サーバー待機中", tone: "neutral" },
  required: { label: "設定が必要", tone: "warning" },
  submitting: { label: "保存中", tone: "info" },
  complete: { label: "設定済み", tone: "success" },
  unavailable: { label: "確認できません", tone: "danger" },
  error: { label: "入力を確認", tone: "danger" }
} as const satisfies Record<ManagerSetupPhase, PhasePresentation>;

const startupPresentations = {
  checking: { label: "確認中", tone: "info" },
  unsupported: { label: "対象外", tone: "neutral" },
  disabled: { label: "無効", tone: "neutral" },
  enabled: { label: "有効", tone: "success" },
  outdated: { label: "更新が必要", tone: "warning" },
  updating: { label: "更新中", tone: "info" },
  error: { label: "確認できません", tone: "danger" }
} as const satisfies Record<ManagerStartupPhase, PhasePresentation>;

const localizedMessages: Record<string, string> = {
  "Checking the BookCafe server…": "サーバーを確認しています。",
  "Starting BookCafe server…": "サーバーを起動しています。",
  "BookCafe server is running.": "サーバーを起動しました。",
  "BookCafe server could not be started.": "サーバーを起動できませんでした。",
  "Stopping BookCafe server…": "サーバーを停止しています。",
  "BookCafe server stopped.": "サーバーを停止しました。",
  "Saving BookCafe setup…": "設定を保存しています。",
  "BookCafe setup is complete.": "設定を保存しました。",
  "Login startup enabled.": "自動起動を有効にしました。",
  "Login startup disabled.": "自動起動を無効にしました。",
  "BookCafe server did not become ready in time.":
    "BookCafeサーバーの起動を時間内に確認できませんでした。",
  "Review the highlighted setup fields.": "入力内容を確認してください。",
  "Review the highlighted network fields.": "ポートを確認してください。",
  "Stop the BookCafe server before changing its port.":
    "ポートを変更する前にBookCafeサーバーを停止してください。",
  "Saving BookCafe server port…": "ポートを保存しています。",
  "BookCafe server port saved.": "ポートを保存しました。",
  "Web UI could not be opened.":
    "Web UIを開けませんでした。既定のブラウザー設定を確認して、もう一度お試しください。",
  "BookCafe data is unavailable.": "データベースを確認できません。",
  "Initial setup input is invalid.": "入力内容を確認してください。",
  "Username or password is invalid.":
    "ユーザー名またはパスワードが正しくありません。",
  "Initial setup is available only from this device.":
    "初期設定はこの端末から実行してください。",
  "BookCafe setup is required.": "初期設定が必要です。",
  "BookCafe setup is already complete.": "初期設定は完了しています。",
  "Account creation is disabled.": "アカウントの追加は無効です。",
  "Authentication required.": "ログインが必要です。",
  "Internal server error.": "サーバーエラーが発生しました。",
  "Server check complete. BookCafe is running.":
    "サーバーの確認が完了しました。BookCafeは稼働中です。",
  "Server check complete. BookCafe is stopped.":
    "サーバーの確認が完了しました。BookCafeは停止しています。",
  "Server check complete. The configured port is in use.":
    "サーバーの確認が完了しました。設定したポートは使用中です。",
  "Server check complete. BookCafe needs attention.":
    "サーバーの確認が完了しました。BookCafeの状態を確認してください。"
};

const localizedFieldErrors: Record<string, string> = {
  username: "ユーザー名は3〜30文字の半角英数字、_、.で入力してください。",
  password: "パスワードは8文字以上で入力してください。",
  confirmPassword: "確認用パスワードが一致しません。",
  port: "ポートは1〜65535の整数で入力してください。",
  form: "入力内容を確認してください。"
};

/** Returns the localized server presentation for a lifecycle phase. */
export const getServerPresentation = (
  phase: ManagerServerPhase,
  managedByDesktop: boolean
): ServerPresentation => {
  if (phase !== "running") {
    return serverPresentations[phase];
  }

  return {
    label: "稼働中",
    detail: managedByDesktop
      ? ""
      : "外部で起動したBookCafeは、このアプリから停止できません。",
    tone: "success"
  };
};

/** Returns the localized setup status shown beside the setup panel. */
export const getSetupPresentation = (
  phase: ManagerSetupPhase
): PhasePresentation => setupPresentations[phase];

/** Returns the localized login-startup status shown beside its setting. */
export const getStartupPresentation = (
  phase: ManagerStartupPhase
): PhasePresentation => startupPresentations[phase];

/** Localizes known controller copy and retains unknown diagnostic text. */
export const localizeDesktopMessage = (
  message: string | null | undefined
): string => {
  if (!message) {
    return "";
  }

  return localizedMessages[message] ?? `診断情報: ${message}`;
};

/** Returns stable Japanese guidance for a controller validation field. */
export const localizeDesktopFieldError = (
  field: string,
  message: string | null | undefined
): string => {
  if (!message) {
    return "";
  }

  return localizedFieldErrors[field] ?? `入力エラー: ${message}`;
};
