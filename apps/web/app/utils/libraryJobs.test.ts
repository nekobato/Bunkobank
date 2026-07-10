import { describe, expect, it } from "vitest";

import type { BackgroundJobResponse } from "@bookcafe/contracts";

import {
  getJobStatusLabel,
  getJobTone,
  getScanJobSummary,
  getScanJobPath,
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
    expect(getJobStatusLabel("queued")).toBe("Queued");
    expect(getJobStatusLabel("running")).toBe("Running");
    expect(getJobStatusLabel("completed")).toBe("Completed");
    expect(getJobStatusLabel("failed")).toBe("Failed");
    expect(getJobStatusLabel("cancelled")).toBe("Cancelled");

    expect(getJobTone("queued")).toBe("active");
    expect(getJobTone("running")).toBe("active");
    expect(getJobTone("completed")).toBe("success");
    expect(getJobTone("failed")).toBe("danger");
    expect(getJobTone("cancelled")).toBe("neutral");
  });

  it("reads a scan target path only from valid object payloads", () => {
    expect(
      getScanJobPath(
        createJob({
          payload: {
            collectionRootId: "root-id",
            path: "/Volumes/sabi/Books/Comic"
          }
        })
      )
    ).toBe("/Volumes/sabi/Books/Comic");
    expect(getScanJobPath(createJob({ payload: { path: "" } }))).toBeNull();
    expect(getScanJobPath(createJob({ payload: null }))).toBeNull();
  });

  it("formats scan result summaries only when count payloads are valid", () => {
    expect(
      getScanJobSummary(
        createJob({
          payload: {
            discoveredBooks: 3,
            missingBooks: 1
          }
        })
      )
    ).toBe("3 discovered, 1 missing");
    expect(
      getScanJobSummary(
        createJob({
          payload: {
            discoveredBooks: 1,
            missingBooks: 0
          }
        })
      )
    ).toBe("1 discovered");
    expect(
      getScanJobSummary(createJob({ payload: { discoveredBooks: "3" } }))
    ).toBeNull();
  });
});

/**
 * Creates a background job response with focused overrides for tests.
 */
const createJob = (
  overrides: Partial<BackgroundJobResponse> = {}
): BackgroundJobResponse => ({
  id: overrides.id ?? "job-id",
  type: overrides.type ?? "scan-collection-root",
  status: overrides.status ?? "completed",
  payload:
    "payload" in overrides
      ? overrides.payload
      : {
          collectionRootId: "root-id",
          path: "/collection"
        },
  progress: overrides.progress ?? 100,
  error: overrides.error ?? null,
  canCancel: overrides.canCancel ?? false,
  createdAt: overrides.createdAt ?? "2026-07-09T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-07-09T00:00:00.000Z"
});
