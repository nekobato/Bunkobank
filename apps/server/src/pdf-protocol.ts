/**
 * Stable IPC protocol and approved resource limits for isolated PDF work.
 */

import type {
  PdfPageEntry,
  RenderPdfPageImageOptions
} from "@bookcafe/format-adapters";

/** Command-line marker that starts the server executable as a PDF worker. */
export const pdfWorkerArgument = "--bookcafe-pdf-worker";

/** Maximum V8 old-generation heap allocated to one PDF worker. */
export const pdfProcessMaxOldSpaceSizeMiB = 768;

/** Maximum execution time for one PDF operation. */
export const pdfProcessTimeoutMs = 120_000;

/** Maximum number of PDF worker processes active at once. */
export const pdfProcessConcurrency = 1;

/** Requests supported by the isolated PDF worker. */
export type PdfWorkerRequest =
  | {
      operation: "list-pages";
      pdfPath: string;
    }
  | {
      operation: "render-page";
      pdfPath: string;
      pageNumber: number;
      options: RenderPdfPageImageOptions;
    };

/** Successful page-list response from the isolated PDF worker. */
export interface PdfWorkerPageListResponse {
  ok: true;
  operation: "list-pages";
  pages: PdfPageEntry[];
}

/** Successful page-render response from the isolated PDF worker. */
export interface PdfWorkerPageRenderResponse {
  ok: true;
  operation: "render-page";
  imageBase64: string | null;
}

/** Path-free failure response from the isolated PDF worker. */
export interface PdfWorkerFailureResponse {
  ok: false;
  error: "PDF processing failed.";
}

/** Responses supported by the isolated PDF worker. */
export type PdfWorkerResponse =
  | PdfWorkerPageListResponse
  | PdfWorkerPageRenderResponse
  | PdfWorkerFailureResponse;

/**
 * Returns whether process arguments select PDF worker mode.
 */
export const isPdfWorkerInvocation = (arguments_: readonly string[]): boolean =>
  arguments_.includes(pdfWorkerArgument);

/**
 * Validates an untrusted IPC value as a PDF worker request.
 */
export const isPdfWorkerRequest = (
  value: unknown
): value is PdfWorkerRequest => {
  if (!isRecord(value) || typeof value.pdfPath !== "string") {
    return false;
  }

  if (value.operation === "list-pages") {
    return true;
  }

  return (
    value.operation === "render-page" &&
    Number.isInteger(value.pageNumber) &&
    Number(value.pageNumber) >= 1 &&
    isRenderOptions(value.options)
  );
};

/**
 * Validates an untrusted IPC value as a PDF worker response.
 */
export const isPdfWorkerResponse = (
  value: unknown
): value is PdfWorkerResponse => {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (!value.ok) {
    return value.error === "PDF processing failed.";
  }

  if (value.operation === "list-pages") {
    return Array.isArray(value.pages) && value.pages.every(isPdfPageEntry);
  }

  return (
    value.operation === "render-page" &&
    (typeof value.imageBase64 === "string" || value.imageBase64 === null)
  );
};

/**
 * Validates the bounded render settings sent over IPC.
 */
const isRenderOptions = (value: unknown): value is RenderPdfPageImageOptions =>
  isRecord(value) &&
  (value.scale === undefined ||
    (typeof value.scale === "number" && Number.isFinite(value.scale))) &&
  (value.maxDimension === undefined ||
    (typeof value.maxDimension === "number" &&
      Number.isFinite(value.maxDimension)));

/**
 * Validates one PDF page description sent over IPC.
 */
const isPdfPageEntry = (value: unknown): value is PdfPageEntry =>
  isRecord(value) &&
  Number.isInteger(value.pageNumber) &&
  Number(value.pageNumber) >= 1 &&
  typeof value.width === "number" &&
  Number.isFinite(value.width) &&
  typeof value.height === "number" &&
  Number.isFinite(value.height);

/**
 * Narrows an unknown IPC value to an object with string keys.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
