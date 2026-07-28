/**
 * Initial scan pipeline types and pure helpers.
 */

import { readdir, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";

import { scanFailureCodes } from "@bookcafe/core";
import type {
  BookFormat,
  ScanFailureCode,
  ScanFailureKind
} from "@bookcafe/core";
import type { PdfPageEntry } from "@bookcafe/format-adapters";
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
const pdfScanConcurrency = 1;

/** Lists PDF pages through the caller-selected parsing boundary. */
export type ListPdfPages = (
  pdfPath: string,
  signal?: AbortSignal
) => Promise<PdfPageEntry[]>;

export interface CandidateSource {
  path: string;
  isDirectory: boolean;
  size: number | null;
  mtimeMs: number | null;
}

/**
 * Controls filesystem and format parsing parallelism during a scan.
 */
export interface ScanLibraryOptions {
  concurrency?: number;
  excludedRelativePaths?: ReadonlySet<string> | readonly string[];
  listPdfPages?: ListPdfPages;
  onCandidateError?: (failure: ScanCandidateFailure) => void;
  signal?: AbortSignal;
}

/** Safe identity of a supported source or subtree that could not be read. */
export type ScanCandidateFailure = {
  kind: ScanFailureKind;
  relativePath: string;
  format: BookFormat;
  code: ScanFailureCode;
};

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
  excludedRelativePaths: ReadonlySet<string>;
  listPdfPages: ListPdfPages;
  onCandidateError?: (failure: ScanCandidateFailure) => void;
  rootPath: string;
  signal?: AbortSignal;
}

export type ScannedPageSourceType =
  "file" | "archive-entry" | "packed-archive-entry" | "pdf-page" | "epub-page";

export interface ScannedBookPage {
  sourceType: ScannedPageSourceType;
  relativePath: string;
  entryPath?: string | null;
  sourcePageNumber?: number | null;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
}

export interface ScannedBook {
  relativePath: string;
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
 * Scans one library root and yields library-relative books incrementally.
 */
export const scanLibrary = async function* (
  rootPath: string,
  options: ScanLibraryOptions = {}
): AsyncGenerator<ScannedBook, void, void> {
  const root = resolve(rootPath);
  const runtime = createScanRuntime(root, options);

  runtime.signal?.throwIfAborted();
  const rootStat = await stat(root);
  runtime.signal?.throwIfAborted();

  if (!rootStat.isDirectory()) {
    return;
  }

  yield* scanDirectory(root, runtime);
};

/**
 * Compatibility alias for callers migrating from Collection Root terminology.
 *
 * @deprecated Use {@link scanLibrary}.
 */
export const scanCollectionRoot = scanLibrary;

/**
 * Recursively scans a directory for image-folder books.
 */
const scanDirectory = async function* (
  directoryPath: string,
  runtime: ScanRuntime
): AsyncGenerator<ScannedBook, void, void> {
  runtime.signal?.throwIfAborted();

  if (isExcludedSource(directoryPath, runtime)) {
    return;
  }

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
    try {
      yield await createImageFolderBook(directoryPath, imageNames, runtime);
    } catch (error) {
      runtime.signal?.throwIfAborted();
      reportCandidateError(directoryPath, "image-folder", error, runtime);
    }

    return;
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
  yield* yieldScannedBooks(
    archiveCandidates,
    (candidate) =>
      createArchiveBook(candidate.path, runtime.rootPath, candidate.format),
    runtime
  );
  const pdfCandidates = sortFileBookCandidates(
    fileCandidates.filter((candidate) => candidate.format === "pdf")
  );
  yield* yieldScannedBooks(
    pdfCandidates,
    (candidate) => createPdfBook(candidate.path, runtime),
    runtime,
    pdfScanConcurrency
  );
  const epubCandidates = sortFileBookCandidates(
    fileCandidates.filter((candidate) => candidate.format === "epub")
  );
  yield* yieldScannedBooks(
    epubCandidates,
    (candidate) => createEpubBook(candidate.path, runtime.rootPath),
    runtime
  );
  const packedArchiveCandidates = sortFileBookCandidates(
    fileCandidates.filter(
      (candidate) =>
        candidate.format === "rar" ||
        candidate.format === "cbr" ||
        candidate.format === "seven-zip"
    )
  );
  yield* yieldScannedBooks(
    packedArchiveCandidates,
    (candidate) =>
      createPackedArchiveBook(
        candidate.path,
        runtime.rootPath,
        candidate.format
      ),
    runtime
  );
  const childDirectories = sortPageNames(
    entries
      .filter(
        (entry) => entry.isDirectory() && !isExcludedFilesystemEntry(entry.name)
      )
      .map((entry) => entry.name)
  );
  for (const name of childDirectories) {
    runtime.signal?.throwIfAborted();
    yield* scanDirectorySafely(join(directoryPath, name), runtime);
  }

  runtime.signal?.throwIfAborted();
};

/**
 * Scans a child directory without letting one unreadable subtree stop the root.
 */
const scanDirectorySafely = async function* (
  directoryPath: string,
  runtime: ScanRuntime
): AsyncGenerator<ScannedBook, void, void> {
  try {
    yield* scanDirectory(directoryPath, runtime);
  } catch {
    runtime.signal?.throwIfAborted();
    runtime.onCandidateError?.({
      kind: "subtree",
      relativePath: toLibraryRelativePath(runtime.rootPath, directoryPath),
      format: "unknown",
      code: "DIRECTORY_UNREADABLE"
    });
  }
};

/**
 * Parses file candidates with bounded concurrency and yields them in scan order.
 */
const yieldScannedBooks = async function* (
  candidates: FileBookCandidate[],
  createBook: (candidate: FileBookCandidate) => Promise<ScannedBook | null>,
  runtime: ScanRuntime,
  concurrency = runtime.concurrency
): AsyncGenerator<ScannedBook, void, void> {
  for await (const book of mapWithConcurrencyStream(
    candidates,
    concurrency,
    (candidate) =>
      createScannedBookSafely(() => createBook(candidate), candidate, runtime),
    runtime.signal
  )) {
    if (book) {
      yield book;
    }
  }
};

/**
 * Creates one book without letting one unreadable candidate stop the scan.
 */
const createScannedBookSafely = async (
  createBook: () => Promise<ScannedBook | null>,
  candidate: FileBookCandidate,
  runtime: ScanRuntime
): Promise<ScannedBook | null> => {
  try {
    runtime.signal?.throwIfAborted();
    const book = await createBook();
    runtime.signal?.throwIfAborted();
    return book;
  } catch (error) {
    runtime.signal?.throwIfAborted();
    reportCandidateError(candidate.path, candidate.format, error, runtime);
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

        if (isExcludedSource(path, runtime)) {
          return null;
        }

        try {
          const candidate = {
            name: entry.name,
            path,
            format: await detectFileFormat(path, false)
          };

          runtime.signal?.throwIfAborted();
          return candidate;
        } catch (error) {
          runtime.signal?.throwIfAborted();
          const format = detectFormat(path, false);

          if (format !== "unknown") {
            reportCandidateError(
              path,
              format,
              error,
              runtime,
              "SOURCE_UNREADABLE"
            );
          }

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
  const relativePath = toLibraryRelativePath(runtime.rootPath, directoryPath);
  const candidate = toScanCandidate({
    path: relativePath,
    isDirectory: true,
    size,
    mtimeMs
  });
  const relativePagePaths = pagePaths.map((pagePath) =>
    toLibraryRelativePath(runtime.rootPath, pagePath)
  );

  return {
    relativePath,
    title: basename(directoryPath),
    authors: [],
    format: "image-folder",
    pagePaths: relativePagePaths,
    pages: relativePagePaths.map((pagePath) => ({
      sourceType: "file",
      relativePath: pagePath,
      mimeType: getImageMimeType(pagePath)
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
  rootPath: string,
  detectedFormat: BookFormat = detectFormat(archivePath, false)
): Promise<ScannedBook | null> => {
  const normalizedArchivePath = resolve(archivePath);
  const relativePath = toLibraryRelativePath(rootPath, normalizedArchivePath);
  const entries = await listArchiveImageEntries(normalizedArchivePath);

  if (entries.length === 0) {
    return null;
  }

  const fileStat = await stat(normalizedArchivePath);
  const candidate = toScanCandidate({
    path: relativePath,
    isDirectory: false,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  });
  const format = detectedFormat === "cbz" ? "cbz" : "zip";

  return {
    relativePath,
    title: basename(normalizedArchivePath, extname(normalizedArchivePath)),
    authors: [],
    format,
    pagePaths: entries.map((entry) => entry.entryPath),
    pages: entries.map((entry) => ({
      sourceType: "archive-entry",
      relativePath,
      entryPath: entry.entryPath,
      mimeType: getImageMimeType(entry.entryPath)
    })),
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    fingerprint: candidate.fingerprint
  };
};

/**
 * Creates a scanned book from a PDF and its renderable pages.
 */
const createPdfBook = async (
  pdfPath: string,
  runtime: ScanRuntime
): Promise<ScannedBook | null> => {
  const normalizedPdfPath = resolve(pdfPath);
  const relativePath = toLibraryRelativePath(
    runtime.rootPath,
    normalizedPdfPath
  );
  const pages = await runtime.listPdfPages(normalizedPdfPath, runtime.signal);

  if (pages.length === 0) {
    return null;
  }

  const fileStat = await stat(normalizedPdfPath);
  const candidate = toScanCandidate({
    path: relativePath,
    isDirectory: false,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  });

  return {
    relativePath,
    title: basename(normalizedPdfPath, extname(normalizedPdfPath)),
    authors: [],
    format: "pdf",
    pagePaths: pages.map((page) => `page:${page.pageNumber}`),
    pages: pages.map((page) => ({
      sourceType: "pdf-page",
      relativePath,
      sourcePageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      mimeType: "image/png"
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
  epubPath: string,
  rootPath: string
): Promise<ScannedBook | null> => {
  const normalizedEpubPath = resolve(epubPath);
  const relativePath = toLibraryRelativePath(rootPath, normalizedEpubPath);
  const pages = await listEpubPages(normalizedEpubPath);
  const metadata = await readEpubMetadata(normalizedEpubPath);

  if (pages.length === 0) {
    return null;
  }

  const fileStat = await stat(normalizedEpubPath);
  const candidate = toScanCandidate({
    path: relativePath,
    isDirectory: false,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  });

  return {
    relativePath,
    title:
      metadata.title ??
      basename(normalizedEpubPath, extname(normalizedEpubPath)),
    authors: metadata.authors,
    format: "epub",
    pagePaths: pages.map((page) => `page:${page.pageNumber}`),
    pages: pages.map((page) => ({
      sourceType: "epub-page",
      relativePath,
      sourcePageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      mimeType: "image/png"
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
  rootPath: string,
  detectedFormat: BookFormat = detectFormat(archivePath, false)
): Promise<ScannedBook | null> => {
  const normalizedArchivePath = resolve(archivePath);
  const relativePath = toLibraryRelativePath(rootPath, normalizedArchivePath);
  const entries = await listPackedArchiveImageEntries(normalizedArchivePath);

  if (entries.length === 0) {
    return null;
  }

  const fileStat = await stat(normalizedArchivePath);
  const candidate = toScanCandidate({
    path: relativePath,
    isDirectory: false,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  });
  const format = toPackedArchiveFormat(detectedFormat);

  if (!format) {
    return null;
  }

  return {
    relativePath,
    title: basename(normalizedArchivePath, extname(normalizedArchivePath)),
    authors: [],
    format,
    pagePaths: entries.map((entry) => entry.entryPath),
    pages: entries.map((entry) => ({
      sourceType: "packed-archive-entry",
      relativePath,
      entryPath: entry.entryPath,
      mimeType: getImageMimeType(entry.entryPath)
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
 * Creates the shared runtime knobs for one library scan.
 */
const createScanRuntime = (
  rootPath: string,
  options: ScanLibraryOptions
): ScanRuntime => ({
  concurrency: normalizeScanConcurrency(options.concurrency),
  excludedRelativePaths: new Set(
    Array.from(options.excludedRelativePaths ?? []).map(normalizeLocator)
  ),
  listPdfPages: options.listPdfPages ?? listPdfPages,
  onCandidateError: options.onCandidateError,
  rootPath,
  signal: options.signal
});

/**
 * Reports a parse failure without exposing an absolute source path.
 */
const reportCandidateError = (
  sourcePath: string,
  format: BookFormat,
  error: unknown,
  runtime: ScanRuntime,
  fallbackCode?: ScanFailureCode
): void => {
  runtime.onCandidateError?.({
    kind: "book",
    relativePath: toLibraryRelativePath(runtime.rootPath, sourcePath),
    format,
    code: getScanFailureCode(format, error, fallbackCode)
  });
};

/**
 * Maps an internal parse exception to a stable, path-free diagnostic code.
 */
const getScanFailureCode = (
  format: BookFormat,
  error: unknown,
  fallbackCode?: ScanFailureCode
): ScanFailureCode => {
  const errorCode =
    error instanceof Error && "code" in error ? error.code : undefined;

  if (
    typeof errorCode === "string" &&
    scanFailureCodes.some((code) => code === errorCode)
  ) {
    return errorCode as ScanFailureCode;
  }

  if (errorCode === "PDF_PROCESS_PROTOCOL_ERROR") {
    return "PDF_PROCESS_FAILED";
  }

  if (fallbackCode) {
    return fallbackCode;
  }

  if (
    format === "zip" ||
    format === "cbz" ||
    format === "rar" ||
    format === "cbr" ||
    format === "seven-zip"
  ) {
    return "ARCHIVE_PARSE_FAILED";
  }

  if (format === "epub") {
    return "EPUB_PARSE_FAILED";
  }

  if (format === "pdf") {
    return "PDF_PARSE_FAILED";
  }

  return "SOURCE_UNREADABLE";
};

/**
 * Returns whether a source was archived and must be skipped before parsing.
 */
const isExcludedSource = (
  sourcePath: string,
  runtime: ScanRuntime
): boolean => {
  const relativePath = toLibraryRelativePath(runtime.rootPath, sourcePath);
  return (
    relativePath.length > 0 && runtime.excludedRelativePaths.has(relativePath)
  );
};

/**
 * Converts an absolute filesystem source into a safe library-relative locator.
 */
const toLibraryRelativePath = (
  rootPath: string,
  sourcePath: string
): string => {
  const relativePath = relative(rootPath, resolve(sourcePath));

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("The scanned source is outside the library root.");
  }

  return normalizeLocator(relativePath) || ".";
};

/**
 * Normalizes a filesystem or archive locator to forward slashes.
 */
const normalizeLocator = (value: string): string =>
  value
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");

/**
 * Returns the MIME type for a supported page image extension.
 */
const getImageMimeType = (path: string): string | null => {
  const extension = extname(path).toLocaleLowerCase();

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".avif") {
    return "image/avif";
  }

  return null;
};

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

interface SettledValue<Output> {
  error?: unknown;
  value?: Output;
}

/**
 * Maps async work through a bounded queue while yielding ordered results.
 */
const mapWithConcurrencyStream = async function* <Input, Output>(
  items: Input[],
  concurrency: number,
  mapper: (item: Input, index: number) => Promise<Output>,
  signal?: AbortSignal
): AsyncGenerator<Output, void, void> {
  signal?.throwIfAborted();
  const pending = new Map<number, Promise<SettledValue<Output>>>();
  let nextScheduleIndex = 0;

  const schedule = (): void => {
    while (
      nextScheduleIndex < items.length &&
      pending.size < Math.min(concurrency, items.length)
    ) {
      const index = nextScheduleIndex;
      nextScheduleIndex += 1;
      const item = items[index] as Input;
      const task = Promise.resolve()
        .then(() => mapper(item, index))
        .then(
          (value): SettledValue<Output> => ({ value }),
          (error): SettledValue<Output> => ({ error })
        );
      pending.set(index, task);
    }
  };

  schedule();

  for (let index = 0; index < items.length; index += 1) {
    signal?.throwIfAborted();
    const result = await pending.get(index);
    pending.delete(index);
    schedule();

    if (!result) {
      throw new Error("A queued scan result was unavailable.");
    }

    if ("error" in result) {
      throw result.error;
    }

    yield result.value as Output;
  }
};
