/**
 * Child-side executor for one isolated PDF operation.
 */

import { listPdfPages, renderPdfPageImage } from "@bookcafe/format-adapters";

import {
  isPdfWorkerRequest,
  type PdfWorkerRequest,
  type PdfWorkerResponse
} from "./pdf-protocol.js";

/** Dependencies used by the child-side PDF operation dispatcher. */
export interface ExecutePdfWorkerRequestDependencies {
  listPdfPages?: typeof listPdfPages;
  renderPdfPageImage?: typeof renderPdfPageImage;
}

/**
 * Executes one validated PDF request and returns IPC-safe data.
 */
export const executePdfWorkerRequest = async (
  request: PdfWorkerRequest,
  dependencies: ExecutePdfWorkerRequestDependencies = {}
): Promise<PdfWorkerResponse> => {
  if (request.operation === "list-pages") {
    return {
      ok: true,
      operation: "list-pages",
      pages: await (dependencies.listPdfPages ?? listPdfPages)(request.pdfPath)
    };
  }

  const image = await (dependencies.renderPdfPageImage ?? renderPdfPageImage)(
    request.pdfPath,
    request.pageNumber,
    request.options
  );

  return {
    ok: true,
    operation: "render-page",
    imageBase64: image ? Buffer.from(image).toString("base64") : null
  };
};

/**
 * Receives one IPC request, executes it, replies, and lets the worker exit.
 */
export const runPdfWorker = async (): Promise<void> => {
  const message = await receiveWorkerRequest();
  const response = isPdfWorkerRequest(message)
    ? await executePdfWorkerRequest(message).catch((): PdfWorkerResponse => ({
        ok: false,
        error: "PDF processing failed."
      }))
    : ({
        ok: false,
        error: "PDF processing failed."
      } satisfies PdfWorkerResponse);

  await sendWorkerResponse(response);
};

/**
 * Receives the single request from the parent process.
 */
const receiveWorkerRequest = (): Promise<unknown> =>
  new Promise((resolve, reject) => {
    if (!process.send || !process.connected) {
      reject(new Error("PDF worker IPC is unavailable."));
      return;
    }

    process.once("message", resolve);
    process.once("disconnect", () =>
      reject(new Error("PDF worker IPC disconnected before a request."))
    );
  });

/**
 * Sends the single response before disconnecting the IPC channel.
 */
const sendWorkerResponse = (response: PdfWorkerResponse): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!process.send || !process.connected) {
      reject(new Error("PDF worker IPC is unavailable."));
      return;
    }

    process.send(response, (error) => {
      if (error) {
        reject(error);
        return;
      }

      process.disconnect();
      resolve();
    });
  });
