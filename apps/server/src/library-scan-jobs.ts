/**
 * Library-scoped scan job execution.
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  closeDatabase,
  createScanFailure,
  findLibrary,
  listArchivedRelativePaths,
  listBookSummaries,
  markBookScanError,
  markBooksMissingAfterScan,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  openBunkobankDatabase,
  persistScannedBook,
  updateJobPayload,
  updateJobProgress
} from "@bunkobank/db";
import {
  readArchiveImageEntry,
  readPackedArchiveImageEntry,
  renderEpubPageImage
} from "@bunkobank/format-adapters";
import { scanLibrary } from "@bunkobank/scanner";
import PQueue from "p-queue";

import {
  listPdfPagesInChildProcess,
  renderPdfPageImageInChildProcess
} from "./pdf-process.js";
import { generateBookThumbnail } from "./thumbnails.js";

import type {
  ListPdfPages,
  ScanCandidateFailure,
  ScannedBookPage
} from "@bunkobank/scanner";

const thumbnailConcurrency = 1;
const maximumPendingThumbnails = 2;

export interface RunLibraryScanJobOptions {
  databasePath: string;
  thumbnailDir: string;
  thumbnailsEnabled: boolean;
  jobId: string;
  libraryId: string;
  signal?: AbortSignal;
}

export interface RunLibraryScanJobDependencies {
  listPdfPages?: ListPdfPages;
  renderPdfPageImage?: typeof renderPdfPageImageInChildProcess;
  scanLibrary?: typeof scanLibrary;
}

/**
 * Scans one library root and persists each yielded book incrementally.
 */
export const runLibraryScanJob = async (
  options: RunLibraryScanJobOptions,
  dependencies: RunLibraryScanJobDependencies = {}
): Promise<void> => {
  options.signal?.throwIfAborted();
  const database = openBunkobankDatabase(options.databasePath);
  const thumbnailQueue = new PQueue({ concurrency: thumbnailConcurrency });
  thumbnailQueue.on("error", () => undefined);

  try {
    const runningJob = markJobRunning(database, options.jobId);

    if (runningJob?.status !== "running") {
      return;
    }

    const library = findLibrary(database, options.libraryId);

    if (!library) {
      throw new Error("Library not found.");
    }

    await assertReadableDirectory(library.canonicalRootPath);
    const archivedRelativePaths = listArchivedRelativePaths(
      database,
      library.id
    );
    const existingRelativePaths = new Set(
      listBookSummaries(database, library.id).map((book) => book.relativePath)
    );
    const scanId = randomUUID();
    const failedCandidates = new Set<string>();
    const handleCandidateError = (failure: ScanCandidateFailure): void => {
      const failureKey = `${failure.kind}:${failure.relativePath}`;

      if (failedCandidates.has(failureKey)) {
        return;
      }

      failedCandidates.add(failureKey);
      createScanFailure(database, {
        jobId: options.jobId,
        kind: failure.kind,
        relativePath: failure.relativePath,
        format: failure.format,
        code: failure.code
      });
      for (const relativePath of getFailedRelativePaths(
        failure,
        existingRelativePaths
      )) {
        markBookScanError(database, library.id, relativePath, scanId);
      }
    };
    const scannedBooks = (dependencies.scanLibrary ?? scanLibrary)(
      library.canonicalRootPath,
      {
        excludedRelativePaths: new Set(archivedRelativePaths),
        listPdfPages: dependencies.listPdfPages ?? listPdfPagesInChildProcess,
        onCandidateError: handleCandidateError,
        signal: options.signal
      }
    );

    let created = 0;
    let detected = 0;
    let updated = 0;

    for await (const book of scannedBooks) {
      options.signal?.throwIfAborted();
      detected += 1;

      if (existingRelativePaths.has(book.relativePath)) {
        updated += 1;
      } else {
        created += 1;
      }

      const persistedBook = persistScannedBook(database, {
        libraryId: library.id,
        relativePath: book.relativePath,
        title: book.title,
        authors: book.authors,
        format: book.format,
        status: "ready",
        pageCount: book.pages.length,
        readingDirection: "rtl",
        size: book.size,
        mtimeMs: book.mtimeMs,
        fingerprint: book.fingerprint,
        scanId,
        pages: book.pages.map((page, pageIndex) => ({
          pageNumber: pageIndex + 1,
          sourceType: page.sourceType,
          relativePath: page.relativePath,
          entryPath: page.entryPath ?? null,
          sourcePageNumber: page.sourcePageNumber ?? null,
          width: page.width ?? null,
          height: page.height ?? null,
          mimeType: page.mimeType ?? null
        }))
      });

      if (options.thumbnailsEnabled && book.pages[0]) {
        await thumbnailQueue.onSizeLessThan(maximumPendingThumbnails);
        thumbnailQueue
          .add(
            ({ signal }) =>
              generateThumbnailSafely({
                page: book.pages[0] as ScannedBookPage,
                bookId: persistedBook.id,
                database,
                libraryId: library.id,
                rootPath: library.canonicalRootPath,
                thumbnailDir: options.thumbnailDir,
                renderPdfPageImage:
                  dependencies.renderPdfPageImage ??
                  renderPdfPageImageInChildProcess,
                signal: signal ?? options.signal
              }),
            { signal: options.signal }
          )
          .catch(() => undefined);
      }
    }

    await thumbnailQueue.onIdle();
    options.signal?.throwIfAborted();
    updateJobProgress(database, options.jobId, 95);
    const missing = markBooksMissingAfterScan(database, library.id, scanId);

    updateJobPayload(database, options.jobId, {
      detected,
      updated,
      created,
      missing,
      archived: archivedRelativePaths.length,
      failed: failedCandidates.size
    });
    markJobCompleted(database, options.jobId);
  } catch {
    if (!options.signal?.aborted) {
      markJobFailed(database, options.jobId, getSafeScanError());
    }
  } finally {
    await thumbnailQueue.onIdle();
    closeDatabase(database);
  }
};

/**
 * Resolves an unreadable candidate to existing books that were still seen.
 */
const getFailedRelativePaths = (
  failure: ScanCandidateFailure,
  existingRelativePaths: ReadonlySet<string>
): string[] => {
  if (failure.kind === "book") {
    return [failure.relativePath];
  }

  if (failure.relativePath === ".") {
    return [...existingRelativePaths];
  }

  const subtreePrefix = `${failure.relativePath}/`;

  return [...existingRelativePaths].filter(
    (relativePath) =>
      relativePath === failure.relativePath ||
      relativePath.startsWith(subtreePrefix)
  );
};

interface GenerateThumbnailSafelyOptions {
  page: ScannedBookPage;
  bookId: string;
  database: ReturnType<typeof openBunkobankDatabase>;
  libraryId: string;
  rootPath: string;
  thumbnailDir: string;
  renderPdfPageImage: typeof renderPdfPageImageInChildProcess;
  signal?: AbortSignal;
}

/**
 * Generates a best-effort thumbnail without failing the scan job.
 */
const generateThumbnailSafely = async (
  options: GenerateThumbnailSafelyOptions
): Promise<void> => {
  options.signal?.throwIfAborted();

  try {
    const sourcePath = await resolveLibrarySource(
      options.rootPath,
      options.page.relativePath
    );
    const sourceData = await readCoverPage(
      sourcePath,
      options.page,
      options.renderPdfPageImage,
      options.signal
    );

    await generateBookThumbnail({
      database: options.database,
      libraryId: options.libraryId,
      bookId: options.bookId,
      sourcePath: options.page.sourceType === "file" ? sourcePath : undefined,
      sourceData: sourceData ?? undefined,
      thumbnailDir: options.thumbnailDir,
      page: 1,
      signal: options.signal
    });
  } catch {
    options.signal?.throwIfAborted();
  }
};

/**
 * Reads or renders a non-file cover page into image bytes.
 */
const readCoverPage = async (
  sourcePath: string,
  page: ScannedBookPage,
  renderPdfPageImage: typeof renderPdfPageImageInChildProcess,
  signal?: AbortSignal
): Promise<Uint8Array | null> => {
  if (
    (page.sourceType === "archive-entry" ||
      page.sourceType === "packed-archive-entry") &&
    page.entryPath
  ) {
    return page.sourceType === "packed-archive-entry"
      ? readPackedArchiveImageEntry(sourcePath, page.entryPath)
      : readArchiveImageEntry(sourcePath, page.entryPath);
  }

  if (page.sourceType === "pdf-page" && page.sourcePageNumber) {
    return renderPdfPageImage(sourcePath, page.sourcePageNumber, {}, signal);
  }

  if (page.sourceType === "epub-page" && page.sourcePageNumber) {
    return renderEpubPageImage(sourcePath, page.sourcePageNumber);
  }

  return null;
};

/**
 * Resolves a relative source and proves it remains within the library root.
 */
const resolveLibrarySource = (
  rootPath: string,
  relativePath: string
): Promise<string> => {
  const sourcePath = resolve(rootPath, relativePath);
  const pathFromRoot = relative(rootPath, sourcePath);

  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Source path escaped the library root.");
  }

  return realpath(sourcePath).then((canonicalSourcePath) => {
    const canonicalPathFromRoot = relative(rootPath, canonicalSourcePath);

    if (
      canonicalPathFromRoot.startsWith("..") ||
      isAbsolute(canonicalPathFromRoot)
    ) {
      throw new Error("Source path escaped the library root.");
    }

    return canonicalSourcePath;
  });
};

/**
 * Maps scan failures to a stable path-free message for storage and API output.
 */
const getSafeScanError = (): string => "Library scan failed.";

/**
 * Rejects a missing, unreadable, or non-directory library root.
 */
const assertReadableDirectory = async (path: string): Promise<void> => {
  await access(path, constants.R_OK);
  const pathStat = await stat(path);

  if (!pathStat.isDirectory()) {
    throw new Error("Library root is not a readable directory.");
  }
};
