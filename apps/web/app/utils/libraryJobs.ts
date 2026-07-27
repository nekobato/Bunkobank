import type {
  BackgroundJobResponse,
  ScanFailureCode
} from "@bookcafe/contracts";

export type JobTone = "neutral" | "active" | "success" | "danger";

/**
 * Returns true while at least one job still needs UI polling.
 */
export const hasActiveJobs = (jobs: BackgroundJobResponse[]): boolean =>
  jobs.some((job) => job.status === "queued" || job.status === "running");

/**
 * Sorts jobs by their last update time and keeps the newest entries.
 */
export const listRecentJobs = (
  jobs: BackgroundJobResponse[],
  limit = 6
): BackgroundJobResponse[] =>
  [...jobs]
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )
    .slice(0, limit);

/**
 * Formats a job status for compact operation lists.
 */
export const getJobStatusLabel = (
  status: BackgroundJobResponse["status"]
): string => {
  switch (status) {
    case "queued":
      return "待機中";
    case "running":
      return "実行中";
    case "completed":
      return "完了";
    case "failed":
      return "失敗";
    case "cancelled":
      return "キャンセル済み";
  }
};

/**
 * Maps a job status to a stable visual tone.
 */
export const getJobTone = (
  status: BackgroundJobResponse["status"]
): JobTone => {
  switch (status) {
    case "queued":
    case "running":
      return "active";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
  }
};

/**
 * Formats completed scan result counts from a job payload.
 */
export const getScanJobSummary = (
  job: BackgroundJobResponse
): string | null => {
  const payload = job.payload;

  if (!payload || typeof payload !== "object" || !("detected" in payload)) {
    return null;
  }

  const scanPayload = payload as Record<string, unknown>;
  const detected = scanPayload.detected;

  if (
    typeof detected !== "number" ||
    !Number.isInteger(detected) ||
    detected < 0
  ) {
    return null;
  }

  const countOrZero = (value: unknown): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : 0;
  const created = countOrZero(scanPayload.created);
  const updated = countOrZero(scanPayload.updated);
  const failed = countOrZero(scanPayload.failed);
  const missing = countOrZero(scanPayload.missing);
  const parts = [`${detected}冊（新規${created}・更新${updated}）`];

  if (failed > 0) {
    parts.push(`解析失敗${failed}`);
  }

  if (missing > 0) {
    parts.push(`未検出${missing}`);
  }

  return parts.join("、");
};

/**
 * Reads a non-negative failure count from one scan result payload.
 */
export const getScanJobFailureCount = (job: BackgroundJobResponse): number => {
  const payload = job.payload;

  if (!payload || typeof payload !== "object" || !("failed" in payload)) {
    return 0;
  }

  const failed = (payload as Record<string, unknown>).failed;
  return typeof failed === "number" && Number.isInteger(failed) && failed >= 0
    ? failed
    : 0;
};

/**
 * Formats one stable scan failure code for the diagnostics dialog.
 */
export const getScanFailureCodeLabel = (code: ScanFailureCode): string => {
  switch (code) {
    case "SOURCE_UNREADABLE":
      return "元ファイルを読み取れません";
    case "DIRECTORY_UNREADABLE":
      return "ディレクトリを読み取れません";
    case "ARCHIVE_PARSE_FAILED":
      return "書庫を解析できません";
    case "EPUB_PARSE_FAILED":
      return "EPUBを解析できません";
    case "PDF_APPLEDOUBLE_FILE":
      return "PDFではなくmacOSメタデータです";
    case "PDF_INVALID_HEADER":
      return "PDFヘッダーがありません";
    case "PDF_PARSE_FAILED":
      return "PDFを解析できません";
    case "PDF_PROCESS_TIMEOUT":
      return "PDF処理が時間切れになりました";
    case "PDF_PROCESS_FAILED":
      return "PDF処理プロセスが失敗しました";
  }
};
