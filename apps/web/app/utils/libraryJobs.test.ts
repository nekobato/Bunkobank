import { describe, expect, it } from "vitest";

import type { BackgroundJobResponse } from "@bookcafe/contracts";

import {
  getJobStatusLabel,
  getJobTone,
  getScanFailureCodeLabel,
  getScanJobFailureCount,
  getScanJobSummary,
  hasActiveJobs,
  listRecentJobs
} from "./libraryJobs";

describe("library job utilities", () => {
  it("detects queued and running jobs as active", () => {
    expect(
      hasActiveJobs([
        createJob({ status: "completed" }),
        createJob({ status: "queued" })
      ])
    ).toBe(true);
    expect(hasActiveJobs([createJob({ status: "completed" })])).toBe(false);
  });

  it("sorts recent jobs by updated time", () => {
    const oldest = createJob({
      id: "oldest",
      updatedAt: "2026-07-09T00:00:00.000Z"
    });
    const newest = createJob({
      id: "newest",
      updatedAt: "2026-07-09T02:00:00.000Z"
    });
    const middle = createJob({
      id: "middle",
      updatedAt: "2026-07-09T01:00:00.000Z"
    });

    expect(
      listRecentJobs([oldest, newest, middle], 2).map((job) => job.id)
    ).toEqual(["newest", "middle"]);
  });

  it("formats status labels and tones", () => {
    expect(getJobStatusLabel("queued")).toBe("待機中");
    expect(getJobStatusLabel("running")).toBe("実行中");
    expect(getJobStatusLabel("completed")).toBe("完了");
    expect(getJobStatusLabel("failed")).toBe("失敗");
    expect(getJobStatusLabel("cancelled")).toBe("キャンセル済み");

    expect(getJobTone("queued")).toBe("active");
    expect(getJobTone("running")).toBe("active");
    expect(getJobTone("completed")).toBe("success");
    expect(getJobTone("failed")).toBe("danger");
    expect(getJobTone("cancelled")).toBe("neutral");
  });

  it("formats scan result summaries only when count payloads are valid", () => {
    expect(
      getScanJobSummary(
        createJob({
          payload: {
            detected: 3,
            created: 2,
            updated: 1,
            missing: 1,
            archived: 0,
            failed: 1
          }
        })
      )
    ).toBe("3冊（新規2・更新1）、解析失敗1、未検出1");
    expect(
      getScanJobSummary(
        createJob({
          payload: {
            detected: 1,
            created: 1,
            updated: 0,
            missing: 0,
            archived: 0
          }
        })
      )
    ).toBe("1冊（新規1・更新0）");
    expect(
      getScanJobSummary(createJob({ payload: { detected: "3" } }))
    ).toBeNull();
  });

  it("reads only valid non-negative scan failure counts", () => {
    expect(
      getScanJobFailureCount(createJob({ payload: { failed: 123 } }))
    ).toBe(123);
    expect(getScanJobFailureCount(createJob({ payload: { failed: -1 } }))).toBe(
      0
    );
    expect(
      getScanJobFailureCount(createJob({ payload: { failed: "123" } }))
    ).toBe(0);
  });

  it("formats stable scan failure codes without exposing raw errors", () => {
    expect(getScanFailureCodeLabel("PDF_APPLEDOUBLE_FILE")).toBe(
      "PDFではなくmacOSメタデータです"
    );
    expect(getScanFailureCodeLabel("PDF_PROCESS_TIMEOUT")).toBe(
      "PDF処理が時間切れになりました"
    );
    expect(getScanFailureCodeLabel("DIRECTORY_UNREADABLE")).toBe(
      "ディレクトリを読み取れません"
    );
  });
});

/**
 * Creates a background job response with focused overrides for tests.
 */
const createJob = (
  overrides: Partial<BackgroundJobResponse> = {}
): BackgroundJobResponse => ({
  id: overrides.id ?? "job-id",
  libraryId: overrides.libraryId ?? "library-id",
  type: overrides.type ?? "scan-library",
  status: overrides.status ?? "completed",
  payload:
    "payload" in overrides
      ? overrides.payload
      : {
          detected: 1,
          created: 1,
          updated: 0,
          missing: 0,
          archived: 0
        },
  progress: overrides.progress ?? 100,
  error: overrides.error ?? null,
  canCancel: overrides.canCancel ?? false,
  createdAt: overrides.createdAt ?? "2026-07-09T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-07-09T00:00:00.000Z"
});
