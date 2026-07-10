/**
 * In-process job queue wrapper for background work.
 */

import PQueue from "p-queue";

export interface BookCafeJobQueue {
  add: (task: () => Promise<void>) => void;
  onIdle: () => Promise<void>;
}

/**
 * Creates the server-local background job queue.
 */
export const createBookCafeJobQueue = (concurrency = 1): BookCafeJobQueue => {
  const queue = new PQueue({ concurrency });

  queue.on("error", () => undefined);

  return {
    add: (task) => {
      queue.add(task).catch(() => undefined);
    },
    onIdle: () => queue.onIdle()
  };
};
