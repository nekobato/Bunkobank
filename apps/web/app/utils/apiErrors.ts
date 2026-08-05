/**
 * Extracts a compact user-facing API error message.
 */

import {
  apiErrorResponseSchema,
  type ApiErrorCode
} from "@bunkobank/contracts";

const localizedApiErrors: Record<ApiErrorCode, string> = {
  INVALID_INPUT: "入力内容を確認してください。",
  INVALID_SETUP_INPUT: "入力内容を確認してください。",
  INVALID_CREDENTIALS: "ユーザー名またはパスワードが正しくありません。",
  INVALID_LIBRARY_PATH: "対象ディレクトリを確認してください。",
  SETUP_LOCAL_ONLY: "初期設定はこの端末から実行してください。",
  SETUP_REQUIRED: "初期設定が必要です。",
  ALREADY_INITIALIZED: "初期設定は完了しています。",
  SIGN_UP_DISABLED: "アカウントの追加は無効です。",
  DATA_UNAVAILABLE: "データベースを確認できません。",
  LIBRARY_BUSY: "ライブラリを処理中です。",
  LIBRARY_NAME_CONFLICT: "同じ名前のライブラリがあります。",
  LIBRARY_PATH_CONFLICT: "対象ディレクトリが別のライブラリと重複しています。",
  COLLECTION_NAME_CONFLICT: "同じ名前のコレクションがあります。",
  NOT_FOUND: "対象が見つかりません。",
  UNAUTHORIZED: "ログインが必要です。",
  INTERNAL_ERROR: "サーバーエラーが発生しました。"
};

export const getApiErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  const errorCode = getApiErrorCode(error);
  const localizedMessage = errorCode
    ? localizedApiErrors[errorCode]
    : undefined;

  if (localizedMessage) {
    return localizedMessage;
  }

  const responseMessage = getResponseMessage(error);

  if (responseMessage) {
    return responseMessage;
  }

  if (error instanceof Error && error.message) {
    if (isOpaqueNetworkError(error.message)) {
      return fallback;
    }

    return error.message;
  }

  return fallback;
};

/**
 * Extracts a stable Bunkobank error code from Nuxt `$fetch` failures.
 */
export const getApiErrorCode = (error: unknown): ApiErrorCode | null => {
  if (!isRecord(error) || !isRecord(error.data)) {
    return null;
  }

  const parsed = apiErrorResponseSchema.safeParse(error.data);
  return parsed.success ? parsed.data.code : null;
};

/**
 * Returns the recovery message for access errors, or the supplied fallback.
 *
 * @param statusCode - HTTP status code returned by the API.
 * @param fallback - Message used when the error is unrelated to setup or login.
 * @returns A concise message that points to the required recovery action.
 */
export const getAccessErrorMessage = (
  statusCode: number | undefined,
  fallback: string
): string => {
  if (statusCode === 409) {
    return "初期設定が必要です。";
  }

  if (statusCode === 401) {
    return "ログインが必要です。";
  }

  return fallback;
};

/**
 * Detects browser-provided network failures that do not help a user recover.
 */
const isOpaqueNetworkError = (message: string): boolean => {
  const normalizedMessage = message.trim();
  const browserFailure =
    "(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\\.?)";

  return (
    new RegExp(`^${browserFailure}$`, "i").test(normalizedMessage) ||
    new RegExp(`<no response>\\s+${browserFailure}$`, "i").test(
      normalizedMessage
    )
  );
};

/**
 * Reads a JSON `{ message }` body from Nuxt `$fetch`/ofetch style errors.
 */
const getResponseMessage = (error: unknown): string | null => {
  if (!isRecord(error) || !isRecord(error.data)) {
    return null;
  }

  const message = error.data.message;

  return typeof message === "string" && message.length > 0 ? message : null;
};

/**
 * Narrows unknown values to indexable records.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
