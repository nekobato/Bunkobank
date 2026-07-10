/**
 * Tests for scan-job cancellation and terminal-state safety.
 *
 * @module
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveDataPaths, saveConfig } from "@bookcafe/config";
import {
  cancelJob,
  closeDatabase,
  createJob,
  findJob,
  listBookSummaries,
  openBookCafeDatabase,
  upsertCollectionRoot
} from "@bookcafe/db";

import { runScanCollectionRootJob } from "./scan-jobs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runScanCollectionRootJob", () => {
  it("does not overwrite or persist after a running job is cancelled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcafe-scan-job-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.json");
    saveConfig(
      {
        dataDir: dir,
        host: "127.0.0.1",
        port: 4510,
        thumbnails: { enabled: true },
        setupComplete: true
      },
      configPath
    );
    const databasePath = resolveDataPaths(dir).databasePath;
    const database = openBookCafeDatabase(databasePath);
    const root = upsertCollectionRoot(database, join(dir, "collection"));
    const job = createJob(database, {
      type: "scan-collection-root",
      payload: { collectionRootId: root.id, path: root.path }
    });
    closeDatabase(database);

    const controller = new AbortController();
    const scanStarted = createDeferred<void>();
    const runPromise = runScanCollectionRootJob(
      {
        configPath,
        jobId: job.id,
        collectionRootId: root.id,
        signal: controller.signal
      },
      {
        scanCollectionRoot: async (_rootPath, options = {}) => {
          scanStarted.resolve();
          await waitForAbort(options.signal);
          return [];
        }
      }
    );

    await scanStarted.promise;
    const cancellationDatabase = openBookCafeDatabase(databasePath);

    try {
      expect(findJob(cancellationDatabase, job.id)?.status).toBe("running");
      expect(cancelJob(cancellationDatabase, job.id)).toBe("cancelled");
    } finally {
      closeDatabase(cancellationDatabase);
    }

    controller.abort();
    await runPromise;

    const verifiedDatabase = openBookCafeDatabase(databasePath);

    try {
      expect(findJob(verifiedDatabase, job.id)).toEqual(
        expect.objectContaining({
          status: "cancelled",
          progress: 5,
          error: null
        })
      );
      expect(listBookSummaries(verifiedDatabase)).toEqual([]);
    } finally {
      closeDatabase(verifiedDatabase);
    }
  });
});

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

/** Creates a manually resolved promise for deterministic job tests. */
const createDeferred = <Value>(): Deferred<Value> => {
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
};

/** Waits until a provided signal is aborted and then rejects with its reason. */
const waitForAbort = (signal?: AbortSignal): Promise<void> => {
  if (!signal) {
    return Promise.reject(new Error("AbortSignal is required."));
  }

  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true
    });
  });
};
