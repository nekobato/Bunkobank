/**
 * Tests for cancellable in-process background work.
 *
 * @module
 */

import { describe, expect, it } from "vitest";

import { createBookCafeJobQueue } from "./job-queue.js";

describe("createBookCafeJobQueue", () => {
  it("removes a cancelled task before it starts", async () => {
    const queue = createBookCafeJobQueue(1);
    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    let cancelledTaskRan = false;

    queue.add("first", async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    queue.add("cancelled", async () => {
      cancelledTaskRan = true;
    });

    await firstStarted.promise;
    expect(queue.cancel("cancelled")).toBe(true);
    releaseFirst.resolve();
    await queue.onIdle();

    expect(cancelledTaskRan).toBe(false);
    expect(queue.cancel("cancelled")).toBe(false);
  });

  it("propagates cancellation to a running task", async () => {
    const queue = createBookCafeJobQueue(1);
    const taskStarted = createDeferred<void>();
    let observedAbort = false;

    queue.add("running", async (signal) => {
      taskStarted.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true }
        );
      });
    });

    await taskStarted.promise;
    expect(queue.cancel("running")).toBe(true);
    expect(queue.cancel("running")).toBe(false);
    await queue.onIdle();

    expect(observedAbort).toBe(true);
  });

  it("does not report unknown jobs as cancelled", () => {
    const queue = createBookCafeJobQueue();

    expect(queue.cancel("missing")).toBe(false);
  });
});

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

/** Creates a manually resolved promise for deterministic queue tests. */
const createDeferred = <Value>(): Deferred<Value> => {
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
};
