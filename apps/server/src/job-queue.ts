/**
 * In-process job queue wrapper for background work.
 */

import PQueue from "p-queue";

export interface BookCafeJobQueue {
  add: (jobId: string, task: (signal: AbortSignal) => Promise<void>) => void;
  cancel: (jobId: string) => boolean;
  onIdle: () => Promise<void>;
}

/**
 * Creates the server-local background job queue.
 */
export const createBookCafeJobQueue = (concurrency = 1): BookCafeJobQueue => {
  const queue = new PQueue({ concurrency });
  const controllers = new Map<string, AbortController>();

  queue.on("error", () => undefined);

  return {
    add: (jobId, task) => {
      if (controllers.has(jobId)) {
        throw new Error(`Job is already queued: ${jobId}`);
      }

      const controller = new AbortController();
      controllers.set(jobId, controller);

      queue
        .add(
          ({ signal }) => {
            if (!signal) {
              throw new Error("Queued job is missing an AbortSignal.");
            }

            return task(signal);
          },
          {
            id: jobId,
            signal: controller.signal
          }
        )
        .catch(() => undefined)
        .finally(() => {
          if (controllers.get(jobId) === controller) {
            controllers.delete(jobId);
          }
        });
    },
    cancel: (jobId) => {
      const controller = controllers.get(jobId);

      if (!controller || controller.signal.aborted) {
        return false;
      }

      controller.abort(new DOMException("Job cancelled.", "AbortError"));
      return true;
    },
    onIdle: () => queue.onIdle()
  };
};
