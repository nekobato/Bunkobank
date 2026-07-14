import type { BackgroundJobResponse } from "@bookcafe/contracts";

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
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
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
 * Reads the collection root path from a scan job payload when available.
 */
export const getScanJobPath = (job: BackgroundJobResponse): string | null => {
  const payload = job.payload;

  if (!payload || typeof payload !== "object" || !("path" in payload)) {
    return null;
  }

  const path = payload.path;

  return typeof path === "string" && path.length > 0 ? path : null;
};

/**
 * Formats completed scan result counts from a job payload.
 */
export const getScanJobSummary = (
  job: BackgroundJobResponse
): string | null => {
  const payload = job.payload;

  if (
    !payload ||
    typeof payload !== "object" ||
    !("discoveredBooks" in payload)
  ) {
    return null;
  }

  const scanPayload = payload as Record<string, unknown>;
  const discoveredBooks = scanPayload.discoveredBooks;

  if (
    typeof discoveredBooks !== "number" ||
    !Number.isInteger(discoveredBooks) ||
    discoveredBooks < 0
  ) {
    return null;
  }

  const missingValue = scanPayload.missingBooks;
  const missingBooks =
    typeof missingValue === "number" &&
    Number.isInteger(missingValue) &&
    missingValue >= 0
      ? missingValue
      : 0;
  const parts = [`${discoveredBooks} discovered`];

  if (missingBooks > 0) {
    parts.push(`${missingBooks} missing`);
  }

  return parts.join(", ");
};
