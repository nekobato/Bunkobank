/**
 * Scan job execution for collection roots.
 */

import { loadConfig, resolveDataPaths } from "@bookcafe/config";
import {
  closeDatabase,
  findCollectionRoot,
  markMissingBooksForCollectionRoot,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  openBookCafeDatabase,
  persistScannedBook,
  updateJobPayload,
  updateJobProgress
} from "@bookcafe/db";
import {
  readArchiveImageEntry,
  readPackedArchiveImageEntry,
  renderEpubPageImage,
  renderPdfPageImage
} from "@bookcafe/format-adapters";
import { scanCollectionRoot } from "@bookcafe/scanner";

import { generateBookThumbnail } from "./thumbnails.js";

export interface RunScanCollectionRootJobOptions {
  configPath?: string;
  jobId: string;
  collectionRootId: string;
  signal?: AbortSignal;
}

export interface RunScanCollectionRootJobDependencies {
  scanCollectionRoot?: typeof scanCollectionRoot;
}

/**
 * Runs a scan job and persists discovered image-folder books.
 */
export const runScanCollectionRootJob = async (
  options: RunScanCollectionRootJobOptions,
  dependencies: RunScanCollectionRootJobDependencies = {}
): Promise<void> => {
  options.signal?.throwIfAborted();
  const config = loadConfig(options.configPath);
  const paths = resolveDataPaths(config.dataDir);
  const database = openBookCafeDatabase(paths.databasePath);

  try {
    options.signal?.throwIfAborted();
    const runningJob = markJobRunning(database, options.jobId);

    if (runningJob?.status !== "running") {
      return;
    }

    const root = findCollectionRoot(database, options.collectionRootId);

    if (!root) {
      throw new Error("Collection root not found.");
    }

    const scannedBooks = await (
      dependencies.scanCollectionRoot ?? scanCollectionRoot
    )(root.path, {
      signal: options.signal
    });
    options.signal?.throwIfAborted();

    for (const [index, book] of scannedBooks.entries()) {
      options.signal?.throwIfAborted();
      const persistedBook = persistScannedBook(database, {
        collectionRootId: root.id,
        title: book.title,
        authors: book.authors,
        sourcePath: book.sourcePath,
        format: book.format,
        status: "ready",
        pageCount: book.pages.length,
        currentPage: 1,
        readingDirection: "rtl",
        size: book.size,
        mtimeMs: book.mtimeMs,
        fingerprint: book.fingerprint,
        pages: book.pages.map((page, pageIndex) => ({
          pageNumber: pageIndex + 1,
          sourcePath: page.sourcePath,
          sourceType: page.sourceType,
          entryPath: page.entryPath ?? null,
          width: page.width ?? null,
          height: page.height ?? null
        }))
      });

      const coverPage = book.pages[0];

      if (coverPage && config.thumbnails.enabled) {
        try {
          const sourceData =
            coverPage.sourceType === "archive-entry" && coverPage.entryPath
              ? await readArchiveImageEntry(
                  book.sourcePath,
                  coverPage.entryPath
                )
              : coverPage.sourceType === "packed-archive-entry" &&
                  coverPage.entryPath
                ? await readPackedArchiveImageEntry(
                    book.sourcePath,
                    coverPage.entryPath
                  )
                : coverPage.sourceType === "pdf-page"
                  ? await renderPdfPageImage(book.sourcePath, 1)
                  : coverPage.sourceType === "epub-page"
                    ? await renderEpubPageImage(book.sourcePath, 1)
                    : null;

          await generateBookThumbnail({
            database,
            bookId: persistedBook.id,
            sourcePath:
              coverPage.sourceType === "file"
                ? coverPage.sourcePath
                : undefined,
            sourceData: sourceData ?? undefined,
            thumbnailDir: paths.thumbnailDir,
            page: 1,
            signal: options.signal
          });
        } catch {
          options.signal?.throwIfAborted();
          // Thumbnail generation is best effort during scan.
        }
      }

      options.signal?.throwIfAborted();
      updateJobProgress(
        database,
        options.jobId,
        calculateProgress(index + 1, scannedBooks.length)
      );
    }

    options.signal?.throwIfAborted();
    const missingBooks = markMissingBooksForCollectionRoot(
      database,
      root.id,
      scannedBooks.map((book) => book.sourcePath)
    );

    updateJobPayload(database, options.jobId, {
      collectionRootId: root.id,
      path: root.path,
      discoveredBooks: scannedBooks.length,
      missingBooks
    });
    markJobCompleted(database, options.jobId);
  } catch (error) {
    if (options.signal?.aborted) {
      return;
    }

    markJobFailed(
      database,
      options.jobId,
      error instanceof Error ? error.message : "Scan job failed."
    );
  } finally {
    closeDatabase(database);
  }
};

/**
 * Converts item completion into a bounded job progress value.
 */
const calculateProgress = (completed: number, total: number): number => {
  if (total < 1) {
    return 100;
  }

  return Math.min(95, Math.max(5, Math.round((completed / total) * 95)));
};
