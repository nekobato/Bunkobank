/**
 * Parent-side queue and child-process supervisor for memory-heavy PDF work.
 */

import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

import PQueue from "p-queue";

import {
  isPdfWorkerResponse,
  pdfProcessConcurrency,
  pdfProcessMaxOldSpaceSizeMiB,
  pdfProcessTimeoutMs,
  pdfWorkerArgument,
  type PdfWorkerRequest,
  type PdfWorkerResponse
} from "./pdf-protocol.js";

import type { RenderPdfPageImageOptions } from "@bunkobank/format-adapters";

const pdfProcessErrorMessage = "PDF processing failed.";
const pdfProcessTimeoutMessage = "PDF processing timed out.";
const pdfHeaderReadLength = 1024;
const pdfHeaderSignature = Buffer.from("%PDF-", "ascii");
const appleDoubleSignature = Buffer.from([0x00, 0x05, 0x16, 0x07]);

/** Stable error codes produced by the PDF child-process boundary. */
export type PdfProcessErrorCode =
  | "SOURCE_UNREADABLE"
  | "PDF_APPLEDOUBLE_FILE"
  | "PDF_INVALID_HEADER"
  | "PDF_PARSE_FAILED"
  | "PDF_PROCESS_ABORTED"
  | "PDF_PROCESS_FAILED"
  | "PDF_PROCESS_PROTOCOL_ERROR"
  | "PDF_PROCESS_TIMEOUT";

/** Path-free error returned by the PDF child-process boundary. */
export interface PdfProcessError extends Error {
  code: PdfProcessErrorCode;
}

/** Executable and arguments used to start one PDF worker. */
export interface PdfWorkerLaunch {
  command: string;
  args: string[];
}

/** Runtime values used to resolve the PDF worker entrypoint. */
export interface ResolvePdfWorkerLaunchOptions {
  packaged: boolean;
  execPath: string;
  execArgv: readonly string[];
  entrypoint: string | undefined;
}

/** Overrides used by focused child-process supervisor tests. */
export interface RunPdfWorkerRequestOptions {
  launch?: PdfWorkerLaunch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Function signature accepted by the serialized PDF process queue. */
export type PdfWorkerExecutor = (
  request: PdfWorkerRequest,
  options?: RunPdfWorkerRequestOptions
) => Promise<PdfWorkerResponse>;

/** Function that schedules one PDF request through a concurrency-one queue. */
export type PdfProcessRunner = (
  request: PdfWorkerRequest,
  signal?: AbortSignal
) => Promise<PdfWorkerResponse>;

/**
 * Resolves how the current Node or packaged sidecar restarts its entrypoint.
 */
export const resolvePdfWorkerLaunch = (
  options: ResolvePdfWorkerLaunchOptions
): PdfWorkerLaunch => {
  if (options.packaged) {
    return {
      command: options.execPath,
      args: [pdfWorkerArgument]
    };
  }

  if (!options.entrypoint) {
    throw createPdfProcessError("PDF_PROCESS_FAILED", pdfProcessErrorMessage);
  }

  return {
    command: options.execPath,
    args: [
      ...removeInheritedHeapLimit(options.execArgv),
      options.entrypoint,
      pdfWorkerArgument
    ]
  };
};

/**
 * Runs one PDF request in a disposable process and waits for its exit.
 */
export const runPdfWorkerRequest: PdfWorkerExecutor = (
  request,
  options = {}
) => {
  options.signal?.throwIfAborted();
  const launch = options.launch ?? resolveCurrentPdfWorkerLaunch();
  const timeoutMs = options.timeoutMs ?? pdfProcessTimeoutMs;
  const child = spawn(launch.command, launch.args, {
    env: createPdfWorkerEnvironment(),
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true
  });

  return new Promise((resolve, reject) => {
    let response: PdfWorkerResponse | undefined;
    let transportFailed = false;
    let timedOut = false;
    let settled = false;

    /**
     * Completes the request exactly once after the child has stopped.
     */
    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortChild);
      callback();
    };

    /**
     * Terminates the disposable worker when its caller is cancelled.
     */
    const abortChild = (): void => {
      child.kill("SIGKILL");
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timeout.unref();

    options.signal?.addEventListener("abort", abortChild, { once: true });

    child.once("spawn", () => {
      child.send(request, (error) => {
        if (error) {
          transportFailed = true;
          child.kill("SIGKILL");
        }
      });
    });
    child.once("message", (message: unknown) => {
      if (isPdfWorkerResponse(message)) {
        response = message;
        return;
      }

      transportFailed = true;
      child.kill("SIGKILL");
    });
    child.once("error", () => {
      transportFailed = true;
    });
    child.once("close", () => {
      settle(() => {
        if (options.signal?.aborted) {
          reject(getAbortReason(options.signal));
          return;
        }

        if (timedOut) {
          reject(
            createPdfProcessError(
              "PDF_PROCESS_TIMEOUT",
              pdfProcessTimeoutMessage
            )
          );
          return;
        }

        if (transportFailed || !response) {
          reject(
            createPdfProcessError(
              transportFailed
                ? "PDF_PROCESS_PROTOCOL_ERROR"
                : "PDF_PROCESS_FAILED",
              pdfProcessErrorMessage
            )
          );
          return;
        }

        resolve(response);
      });
    });
  });
};

/**
 * Creates a serialized runner so only one bounded PDF process is active.
 */
export const createPdfProcessRunner = (
  execute: PdfWorkerExecutor = runPdfWorkerRequest
): PdfProcessRunner => {
  const queue = new PQueue({ concurrency: pdfProcessConcurrency });

  return (request, signal) =>
    queue.add(() => execute(request, { signal }), { signal });
};

const runPdfProcess = createPdfProcessRunner();

/**
 * Lists PDF pages in the bounded child-process queue.
 */
export const listPdfPagesInChildProcess = async (
  pdfPath: string,
  signal?: AbortSignal
) => {
  await assertPdfHeader(pdfPath, signal);
  const response = await runPdfProcess(
    {
      operation: "list-pages",
      pdfPath
    },
    signal
  );

  if (!response.ok) {
    throw createPdfProcessError("PDF_PARSE_FAILED", response.error);
  }

  if (response.operation !== "list-pages") {
    throw createPdfProcessError(
      "PDF_PROCESS_PROTOCOL_ERROR",
      pdfProcessErrorMessage
    );
  }

  return response.pages;
};

/**
 * Renders one PDF page in the bounded child-process queue.
 */
export const renderPdfPageImageInChildProcess = async (
  pdfPath: string,
  pageNumber: number,
  options: RenderPdfPageImageOptions = {},
  signal?: AbortSignal
): Promise<Uint8Array | null> => {
  await assertPdfHeader(pdfPath, signal);
  const response = await runPdfProcess(
    {
      operation: "render-page",
      pdfPath,
      pageNumber,
      options
    },
    signal
  );

  if (!response.ok) {
    throw createPdfProcessError("PDF_PARSE_FAILED", response.error);
  }

  if (response.operation !== "render-page") {
    throw createPdfProcessError(
      "PDF_PROCESS_PROTOCOL_ERROR",
      pdfProcessErrorMessage
    );
  }

  return response.imageBase64 === null
    ? null
    : new Uint8Array(Buffer.from(response.imageBase64, "base64"));
};

/**
 * Resolves a launch command from the current server runtime.
 */
const resolveCurrentPdfWorkerLaunch = (): PdfWorkerLaunch =>
  resolvePdfWorkerLaunch({
    packaged: "pkg" in process,
    execPath: process.execPath,
    execArgv: process.execArgv,
    entrypoint: process.argv[1]
  });

/**
 * Applies the approved V8 old-generation heap ceiling to the worker.
 */
const createPdfWorkerEnvironment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_OPTIONS: [
    process.env.NODE_OPTIONS?.trim(),
    `--max-old-space-size=${pdfProcessMaxOldSpaceSizeMiB}`
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
});

/**
 * Removes a parent heap flag so it cannot override the worker limit.
 */
const removeInheritedHeapLimit = (arguments_: readonly string[]): string[] => {
  const filtered: string[] = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] as string;

    if (/^--max[-_]old[-_]space[-_]size=/.test(argument)) {
      continue;
    }

    if (/^--max[-_]old[-_]space[-_]size$/.test(argument)) {
      index += 1;
      continue;
    }

    filtered.push(argument);
  }

  return filtered;
};

/**
 * Rejects AppleDouble and headerless files before starting a PDF worker.
 */
const assertPdfHeader = async (
  pdfPath: string,
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted();
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(pdfPath, "r");
    const header = Buffer.alloc(pdfHeaderReadLength);
    const { bytesRead } = await handle.read(header, 0, pdfHeaderReadLength, 0);
    const readableHeader = header.subarray(0, bytesRead);

    if (
      readableHeader
        .subarray(0, appleDoubleSignature.length)
        .equals(appleDoubleSignature)
    ) {
      throw createPdfProcessError(
        "PDF_APPLEDOUBLE_FILE",
        pdfProcessErrorMessage
      );
    }

    if (readableHeader.indexOf(pdfHeaderSignature) < 0) {
      throw createPdfProcessError("PDF_INVALID_HEADER", pdfProcessErrorMessage);
    }
  } catch (error) {
    signal?.throwIfAborted();

    if (isPdfProcessError(error)) {
      throw error;
    }

    throw createPdfProcessError("SOURCE_UNREADABLE", pdfProcessErrorMessage);
  } finally {
    await handle?.close();
  }

  signal?.throwIfAborted();
};

/**
 * Creates a path-free functional error with a stable code.
 */
const createPdfProcessError = (
  code: PdfProcessErrorCode,
  message: string
): PdfProcessError =>
  Object.assign(new Error(message), {
    name: "PdfProcessError",
    code
  });

/**
 * Returns whether an unknown error already came from the PDF process boundary.
 */
const isPdfProcessError = (error: unknown): error is PdfProcessError =>
  error instanceof Error &&
  error.name === "PdfProcessError" &&
  "code" in error &&
  typeof error.code === "string";

/**
 * Returns the caller-provided abort reason without replacing it.
 */
const getAbortReason = (signal: AbortSignal): unknown => {
  try {
    signal.throwIfAborted();
  } catch (error) {
    return error;
  }

  return createPdfProcessError("PDF_PROCESS_ABORTED", pdfProcessErrorMessage);
};
