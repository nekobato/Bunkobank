import { expect, it } from "vitest";

import type { BackgroundJobResponse } from "@bunkobank/contracts";

import { findActiveScanJob } from "./libraryJobs";

const createJob = (
  id: string,
  libraryId: string,
  status: BackgroundJobResponse["status"]
): BackgroundJobResponse => ({
  id,
  libraryId,
  type: "scan-library",
  status,
  payload: {},
  progress: 0,
  error: null,
  canCancel: status === "queued" || status === "running",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z"
});

it("finds only queued or running scans for the requested library", () => {
  const jobs = [
    createJob("completed-a", "library-a", "completed"),
    createJob("running-b", "library-b", "running"),
    createJob("queued-a", "library-a", "queued")
  ];

  expect(findActiveScanJob(jobs, "library-a")?.id).toBe("queued-a");
  expect(findActiveScanJob(jobs, "library-b")?.id).toBe("running-b");
  expect(findActiveScanJob(jobs, "library-c")).toBeNull();
});
