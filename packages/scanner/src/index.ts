/**
 * Initial scan pipeline types and pure helpers.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import type { BookFormat } from "@bookcafe/core";
import type { Dirent } from "node:fs";
import {
  detectFileFormat,
  detectFormat,
  listEpubPages,
  listArchiveImageEntries,
  listPackedArchiveImageEntries,
  listPdfPages,
  readEpubMetadata
} from "@bookcafe/format-adapters";
import { isImageFile, sortPageNames } from "@bookcafe/format-adapters";

const excludedNames = new Set(["__macosx", "thumbs.db", "desktop.ini"]);
const defaultScanConcurrency = 2;
const maximumScanConcurrency = 8;

export interface CandidateSource {
  path: string;
  isDirectory: boolean;
  size: number | null;
  mtimeMs: number | null;
}

/**
 * Controls filesystem and format parsing parallelism during a scan.
 */
export interface ScanCollectionRootOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

export interface ScanCandidate extends CandidateSource {
  format: BookFormat;
  fingerprint: string;
}

interface FileBookCandidate {
  name: string;
  path: string;
  format: BookFormat;
}

interface ScanRuntime {
  concurrency: number;
  signal?: AbortSignal;
}

export type ScannedPageSourceType =
  "file" | "archive-entry" | "packed-archive-entry" | "pdf-page" | "epub-page";

export interface ScannedBookPage {
  sourcePath: string;
  sourceType: ScannedPageSourceType;
  entryPath?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ScannedBook {
  sourcePath: string;
  title: string;
  authors: string[];
  format:
    | "image-folder"
    | "zip"
    | "cbz"
    | "pdf"
    | "epub"
    | "rar"
    | "cbr"
    | "seven-zip";
  pagePaths: string[];
  pages: ScannedBookPage[];
  size: number;
  mtimeMs: number;
  fingerprint: string;
}

/**
 * Creates a lightweight fingerprint from path, size, and mtime.
 */
export const createFingerprint = (source: CandidateSource): string =>
  [
    source.path,
    source.size ?? "unknown-size",
    source.mtimeMs ?? "unknown-mtime"
  ].join("|");

/**
 * Converts a filesystem source into a scan candidate.
 */
export const toScanCandidate = (source: CandidateSource): ScanCandidate => ({
  ...source,
  format: detectFormat(source.path, source.isDirectory),
  fingerprint: createFingerprint(source)
});

/**
 * Scans a collection root and returns discovered book sources.
 */
export const scanCollectionRoot = async (
  rootPath: string,
  options: ScanCollectionRootOptions = {}
): Promise<ScannedBook[]> => {
  const root = resolve(rootPath);
  const runtime = createScanRuntime(options);

  try {
    runtime.signal?.throwIfAborted();
    const rootStat = await stat(root);
    runtime.signal?.throwIfAborted();

    if (!rootStat.isDirectory()) {
      return [];
    }

    return await scanDirectory(root, runtime);
  } catch {
    runtime.signal?.throwIfAborted();
    return [];
  }
};

/**
 * Recursively scans a directory for image-folder books.
 */
const scanDirectory = async (
  directoryPath: string,
  runtime: ScanRuntime
): Promise<ScannedBook[]> => {
  runtime.signal?.throwIfAborted();
  const entries = await readdir(directoryPath, { withFileTypes: true });
  runtime.signal?.throwIfAborted();
  const imageNames = sortPageNames(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          !isExcludedFilesystemEntry(entry.name) &&
          isImageFile(entry.name)
      )
      .map((entry) => entry.name)
  );

  if (imageNames.length > 0) {
    return [await createImageFolderBook(directoryPath, imageNames, runtime)];
  }

  const fileCandidates = await listFileBookCandidates(
    directoryPath,
    entries,
    runtime
  );
  const archiveCandidates = sortFileBookCandidates(
    fileCandidates.filter(
      (candidate) => candidate.format === "zip" || candidate.format === "cbz"
    )
  );
  const archiveBooks = (
    await mapWithConcurrency(
      archiveCandidates,
      runtime.concurrency,
      (candidate) =>
        createScannedBookSafely(
          () => createArchiveBook(candidate.path, candidate.format),
          runtime.signal
        ),
      runtime.signal
    )
  ).filter((book): book is ScannedBook => book !== null);
  const pdfCandidates = sortFileBookCandidates(
    fileCandidates.filter((candidate) => candidate.format === "pdf")
  );
  const pdfBooks = (
    await mapWithConcurrency(
      pdfCandidates,
      runtime.concurrency,
      (candidate) =>
        createScannedBookSafely(
          () => createPdfBook(candidate.path),
          runtime.signal
        ),
      runtime.signal
    )
  ).filter((book): book is ScannedBook => book !== null);
  const epubCandidates = sortFileBookCandidates(
    fileCandidates.filter((candidate) => candidate.format === "epub")
  );
  const epubBooks = (
    await mapWithConcurrency(
      epubCandidates,
      runtime.concurrency,
      (candidate) =>
        createScannedBookSafely(
          () => createEpubBook(candidate.path),
          runtime.signal
        ),
      runtime.signal
    )
  ).filter((book): book is ScannedBook => book !== null);
  const packedArchiveCandidates = sortFileBookCandidates(
    fileCandidates.filter(
      (candidate) =>
        candidate.format === "rar" ||
        candidate.format === "cbr" ||
        candidate.format === "seven-zip"
    )
  );
  const packedArchiveBooks = (
    await mapWithConcurrency(
      packedArchiveCandidates,
      runtime.concurrency,
      (candidate) =>
        createScannedBookSafely(
          () => createPackedArchiveBook(candidate.path, candidate.format),
          runtime.signal
        ),
      runtime.signal
    )
  ).filter((book): book is ScannedBook => book !== null);
  const childDirectories = sortPageNames(
    entries
      .filter(
        (entry) => entry.isDirectory() && !isExcludedFilesystemEntry(entry.name)
      )
      .map((entry) => entry.name)
  );
  const nestedBooks: ScannedBook[][] = [];

  for (const name of childDirectories) {
    runtime.signal?.throwIfAborted();
    nestedBooks.push(
      await scanDirectorySafely(join(directoryPath, name), runtime)
    );
  }

  runtime.signal?.throwIfAborted();

  return [
    ...archiveBooks,
    ...pdfBooks,
    ...epubBooks,
    ...packedArchiveBooks,
    ...nestedBooks.flat()
  ];
};

/**
 * Scans a child directory without letting one unreadable subtree stop the root.
 */
const scanDirectorySafely = async (
  directoryPath: string,
  runtime: ScanRuntime
): Promise<ScannedBook[]> => {
  try {
    return await scanDirectory(directoryPath, runtime);
  } catch {
    runtime.signal?.throwIfAborted();
    return [];
  }
};

/**
 * Creates one book without letting one unreadable candidate stop the scan.
 */
const createScannedBookSafely = async (
  createBook: () => Promise<ScannedBook | null>,
  signal?: AbortSignal
): Promise<ScannedBook | null> => {
  try {
    signal?.throwIfAborted();
    const book = await createBook();
    signal?.throwIfAborted();
    return book;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
};

/**
 * Detects candidate formats for all files in a directory.
 */
const listFileBookCandidates = async (
  directoryPath: string,
  entries: Dirent[],
  runtime: ScanRuntime
): Promise<FileBookCandidate[]> =>
  (
    await mapWithConcurrency(
      entries.filter(
        (entry) => entry.isFile() && !isExcludedFilesystemEntry(entry.name)
      ),
      runtime.concurrency,
      async (entry) => {
        runtime.signal?.throwIfAborted();
        const path = join(directoryPath, entry.name);

        try {
          const candidate = {
            name: entry.name,
            path,
            format: await detectFileFormat(path, false)
          };

          runtime.signal?.throwIfAborted();
          return candidate;
        } catch {
          runtime.signal?.throwIfAborted();
          return null;
        }
      },
      runtime.signal
    )
  ).filter((candidate): candidate is FileBookCandidate => candidate !== null);

/**
 * Returns true for filesystem entries that should not become scan candidates.
 */
const isExcludedFilesystemEntry = (name: string): boolean => {
  const lowerName = name.toLocaleLowerCase();

  return (
    name.startsWith(".") ||
    name.startsWith("._") ||
    excludedNames.has(lowerName)
  );
};

/**
 * Sorts file candidates by their directory entry name.
 */
const sortFileBookCandidates = (
  candidates: FileBookCandidate[]
): FileBookCandidate[] => {
  const candidateByName = new Map(
    candidates.map((candidate) => [candidate.name, candidate])
  );

  return sortPageNames(candidates.map((candidate) => candidate.name)).flatMap(
    (name) => {
      const candidate = candidateByName.get(name);
      return candidate ? [candidate] : [];
    }
  );
};

/**
 * Creates a scanned book from a directory and its page filenames.
 */
const createImageFolderBook = async (
  directoryPath: string,
  imageNames: string[],
  runtime: ScanRuntime
): Promise<ScannedBook> => {
  const pagePaths = imageNames.map((name) => join(directoryPath, name));
  const stats = await mapWithConcurrency(
    pagePaths,
    runtime.concurrency,
    (path) => stat(path),
    runtime.signal
  );
  const size = stats.reduce((total, item) => total + item.size, 0);
  const mtimeMs = stats.reduce(
    (latest, item) => Math.max(latest, item.mtimeMs),
    0
  );
  const candidate = toScanCandidate({
    path: directoryPath,
    isDirectory: true,
    size,
    mtimeMs
  });

  return {
    sourcePath: directoryPath,
    title: basename(directoryPath),
    authors: [],
    format: "image-folder",
    pagePaths,
    pages: pagePaths.map((pagePath) => ({
      sourcePath: pagePath,
      sourceType: "file"
    })),
    size,
    mtimeMs,
    fingerprint: candidate.fingerprint
  };
};

/**
 * Creates a scanned book from a ZIP/CBZ archive and its image entries.
 */
const createArchiveBook = async (
  archivePath: string,
  detectedFormat: BookFormat = detectFormat(archivePath, false)
): Promise<ScannedBook | null> => {
  const normalizedArchivePath = resolve(archivePath);
  const entries = await listArchiveImageEntries(normalizedArchivePath);

  if (entries.length === 0) {
    return null;
  }

  const fileStat = await stat(normalizedArchivePath);
  const candidate = toScanCandidate({
    path: normalizedArchivePath,
    isDirectory: false,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  });
  const format = detectedFormat === "cbz" ? "cbz" : "zip";

  return {
    sourcePath: normalizedArchivePath,
    title: basename(normalizedArchivePath, extname(normalizedArchivePath)),
    authors: [],
    format,
    pagePaths: entries.map((entry) => entry.entryPath),
    pages: entries.map((entry) => ({
      sourcePath: normalizedArchivePath,
      sourceType: "archive-entry",
      entryPath: entry.entryPath
    })),
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    fingerprint: candidate.fingerprint
  };
};

/**
 * Creates a scanned book from a PDF and its renderable pages.
 */
const createPdfBook = async (pdfPath: string): Promise<ScannedBook | null> => {
  const normalizedPdfPath = resolve(pdfPath);
  const pages = await listPdfPages(normalizedPdfPath);

  if (pages.length === 0) {
    return null;
  }

  const fileStat = await stat(normalizedPdfPath);
  const candidate = toScanCandidate({
    path: normalizedPdfPath,
    isDirectory: false,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  });

  return {
    sourcePath: normalizedPdfPath,
    title: basename(normalizedPdfPath, extname(normalizedPdfPath)),
    authors: [],
    format: "pdf",
    pagePaths: pages.map((page) => `page:${page.pageNumber}`),
    pages: pages.map((page) => ({
      sourcePath: normalizedPdfPath,
      sourceType: "pdf-page",
      entryPath: null,
      width: page.width,
      height: page.height
    })),
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    fingerprint: candidate.fingerprint
  };
};

/**
 * Creates a scanned book from an EPUB and its generated page images.
 */
const createEpubBook = async (
  epubPath: string
): Promise<ScannedBook | null> => {
  const normalizedEpubPath = resolve(epubPath);
  const [pages, metadata] = await Promise.all([
    listEpubPages(normalizedEpubPath),
    readEpubMetadata(normalizedEpubPath)
  ]);

  if (pages.length === 0) {
    return null;
  }

  const fileStat = await stat(normalizedEpubPath);
  const candidate = toScanCandidate({
    path: normalizedEpubPath,
    isDirectory: false,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  });

  return {
    sourcePath: normalizedEpubPath,
    title:
      metadata.title ??
      basename(normalizedEpubPath, extname(normalizedEpubPath)),
    authors: metadata.authors,
    format: "epub",
    pagePaths: pages.map((page) => `page:${page.pageNumber}`),
    pages: pages.map((page) => ({
      sourcePath: normalizedEpubPath,
      sourceType: "epub-page",
      entryPath: null,
      width: page.width,
      height: page.height
    })),
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    fingerprint: candidate.fingerprint
  };
};

/**
 * Creates a scanned book from a RAR/CBR/7z archive and its image entries.
 */
const createPackedArchiveBook = async (
  archivePath: string,
  detectedFormat: BookFormat = detectFormat(archivePath, false)
): Promise<ScannedBook | null> => {
  const normalizedArchivePath = resolve(archivePath);
  const entries = await listPackedArchiveImageEntries(normalizedArchivePath);

  if (entries.length === 0) {
    return null;
  }

  const fileStat = await stat(normalizedArchivePath);
  const candidate = toScanCandidate({
    path: normalizedArchivePath,
    isDirectory: false,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  });
  const format = toPackedArchiveFormat(detectedFormat);

  if (!format) {
    return null;
  }

  return {
    sourcePath: normalizedArchivePath,
    title: basename(normalizedArchivePath, extname(normalizedArchivePath)),
    authors: [],
    format,
    pagePaths: entries.map((entry) => entry.entryPath),
    pages: entries.map((entry) => ({
      sourcePath: normalizedArchivePath,
      sourceType: "packed-archive-entry",
      entryPath: entry.entryPath
    })),
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    fingerprint: candidate.fingerprint
  };
};

/**
 * Narrows detected formats to the libarchive-backed archive formats.
 */
const toPackedArchiveFormat = (
  format: BookFormat
): "rar" | "cbr" | "seven-zip" | null =>
  format === "rar" || format === "cbr" || format === "seven-zip"
    ? format
    : null;

/**
 * Creates the shared runtime knobs for one collection root scan.
 */
const createScanRuntime = (
  options: ScanCollectionRootOptions
): ScanRuntime => ({
  concurrency: normalizeScanConcurrency(options.concurrency),
  signal: options.signal
});

/**
 * Normalizes requested scan concurrency to a small bounded integer.
 */
const normalizeScanConcurrency = (concurrency: number | undefined): number => {
  if (typeof concurrency !== "number" || !Number.isFinite(concurrency)) {
    return defaultScanConcurrency;
  }

  return Math.min(maximumScanConcurrency, Math.max(1, Math.trunc(concurrency)));
};

/**
 * Maps async work while preserving result order and limiting active tasks.
 */
const mapWithConcurrency = async <Input, Output>(
  items: Input[],
  concurrency: number,
  mapper: (item: Input, index: number) => Promise<Output>,
  signal?: AbortSignal
): Promise<Output[]> => {
  signal?.throwIfAborted();

  if (items.length === 0) {
    return [];
  }

  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      signal?.throwIfAborted();
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index] as Input, index);
      signal?.throwIfAborted();
    }
  });

  await Promise.all(workers);
  return results;
};
