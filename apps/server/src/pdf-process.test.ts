import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPdfProcessRunner,
  listPdfPagesInChildProcess,
  resolvePdfWorkerLaunch,
  runPdfWorkerRequest
} from "./pdf-process.js";
import {
  pdfProcessConcurrency,
  pdfProcessMaxOldSpaceSizeMiB,
  pdfProcessTimeoutMs,
  pdfWorkerArgument,
  type PdfWorkerRequest,
  type PdfWorkerResponse
} from "./pdf-protocol.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PDF child process supervisor", () => {
  it("uses the approved resource limits", () => {
    expect(pdfProcessMaxOldSpaceSizeMiB).toBe(768);
    expect(pdfProcessTimeoutMs).toBe(120_000);
    expect(pdfProcessConcurrency).toBe(1);
  });

  it("launches the current entrypoint without inheriting a larger heap flag", () => {
    expect(
      resolvePdfWorkerLaunch({
        packaged: false,
        execPath: "/runtime/node",
        execArgv: ["--max-old-space-size=4096", "--import", "tsx-loader.mjs"],
        entrypoint: "/app/main.ts"
      })
    ).toEqual({
      command: "/runtime/node",
      args: ["--import", "tsx-loader.mjs", "/app/main.ts", pdfWorkerArgument]
    });
    expect(
      resolvePdfWorkerLaunch({
        packaged: true,
        execPath: "/app/bookcafe-server",
        execArgv: [],
        entrypoint: undefined
      })
    ).toEqual({
      command: "/app/bookcafe-server",
      args: [pdfWorkerArgument]
    });
  });

  it("serializes all PDF operations through one queue", async () => {
    let activeOperations = 0;
    let maximumActiveOperations = 0;
    const execute = async (
      request: PdfWorkerRequest
    ): Promise<PdfWorkerResponse> => {
      activeOperations += 1;
      maximumActiveOperations = Math.max(
        maximumActiveOperations,
        activeOperations
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeOperations -= 1;

      return {
        ok: true,
        operation: request.operation,
        ...(request.operation === "list-pages"
          ? { pages: [] }
          : { imageBase64: null })
      } as PdfWorkerResponse;
    };
    const run = createPdfProcessRunner(execute);

    await Promise.all([
      run({ operation: "list-pages", pdfPath: "/books/one.pdf" }),
      run({ operation: "list-pages", pdfPath: "/books/two.pdf" })
    ]);

    expect(maximumActiveOperations).toBe(1);
  });

  it("exchanges one request and response over child-process IPC", async () => {
    const response = await runPdfWorkerRequest(
      { operation: "list-pages", pdfPath: "/books/fixture.pdf" },
      {
        launch: {
          command: process.execPath,
          args: [
            "-e",
            [
              "process.once('message', () => {",
              "process.send({",
              "ok: true,",
              "operation: 'list-pages',",
              "pages: [{ pageNumber: 1, width: 200, height: 260 }]",
              "}, () => process.disconnect());",
              "});"
            ].join("")
          ]
        },
        timeoutMs: 1_000
      }
    );

    expect(response).toEqual({
      ok: true,
      operation: "list-pages",
      pages: [{ pageNumber: 1, width: 200, height: 260 }]
    });
  });

  it("kills and rejects a PDF process after its deadline", async () => {
    await expect(
      runPdfWorkerRequest(
        { operation: "list-pages", pdfPath: "/books/slow.pdf" },
        {
          launch: {
            command: process.execPath,
            args: [
              "-e",
              "process.once('message', () => setInterval(() => {}, 1000));"
            ]
          },
          timeoutMs: 25
        }
      )
    ).rejects.toMatchObject({
      name: "PdfProcessError",
      code: "PDF_PROCESS_TIMEOUT"
    });
  });

  it("maps a worker crash to a stable path-free failure", async () => {
    await expect(
      runPdfWorkerRequest(
        { operation: "list-pages", pdfPath: "/private/books/crash.pdf" },
        {
          launch: {
            command: process.execPath,
            args: ["-e", "process.once('message', () => process.exit(7));"]
          },
          timeoutMs: 1_000
        }
      )
    ).rejects.toMatchObject({
      name: "PdfProcessError",
      code: "PDF_PROCESS_FAILED",
      message: "PDF processing failed."
    });
  });

  it("rejects AppleDouble metadata before starting a PDF worker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bookcafe-pdf-process-"));
    tempDirs.push(directory);
    const pdfPath = join(directory, "._Volume.pdf");
    writeFileSync(pdfPath, Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00]));

    await expect(listPdfPagesInChildProcess(pdfPath)).rejects.toMatchObject({
      name: "PdfProcessError",
      code: "PDF_APPLEDOUBLE_FILE",
      message: "PDF processing failed."
    });
  });

  it("rejects files without a PDF header before starting a worker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bookcafe-pdf-process-"));
    tempDirs.push(directory);
    const pdfPath = join(directory, "Broken.pdf");
    writeFileSync(pdfPath, "not a PDF");

    await expect(listPdfPagesInChildProcess(pdfPath)).rejects.toMatchObject({
      name: "PdfProcessError",
      code: "PDF_INVALID_HEADER",
      message: "PDF processing failed."
    });
  });

  it("maps an unreadable PDF source to a stable path-free code", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bookcafe-pdf-process-"));
    tempDirs.push(directory);
    const pdfPath = join(directory, "Missing.pdf");

    await expect(listPdfPagesInChildProcess(pdfPath)).rejects.toMatchObject({
      name: "PdfProcessError",
      code: "SOURCE_UNREADABLE",
      message: "PDF processing failed."
    });
  });
});
