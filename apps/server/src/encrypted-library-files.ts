/** Encrypted-library import, transient plaintext, and source delivery helpers. */

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, unlink } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";

import type {
  Bec1LibraryEncryptor,
  Bec1OpenContainer
} from "@bunkobank/encrypted-container";
import {
  findBookDetail,
  persistScannedBook,
  type BunkobankDatabase,
  type LibraryRecord
} from "@bunkobank/db";
import {
  readArchiveImageEntry,
  readPackedArchiveImageEntry,
  renderEpubPageImage
} from "@bunkobank/format-adapters";
import { scanBookFile, type ScannedBookPage } from "@bunkobank/scanner";

import { createIterableResponse } from "./byte-range.js";
import {
  listPdfPagesInChildProcess,
  renderPdfPageImageInChildProcess
} from "./pdf-process.js";
import { generateBookThumbnail } from "./thumbnails.js";

export interface ImportEncryptedBookOptions {
  database: BunkobankDatabase;
  library: LibraryRecord;
  encryptor: Bec1LibraryEncryptor;
  sourcePath: string;
  originalName: string;
  thumbnailDir: string;
  thumbnailsEnabled: boolean;
  signal?: AbortSignal;
}

export interface WithUploadedBookOptions {
  body: ReadableStream<Uint8Array>;
  originalName: string;
  cacheDir: string;
  signal?: AbortSignal;
}

export interface EncryptedSourceResponseOptions {
  request: Request;
  library: LibraryRecord;
  relativePath: string;
  encryptor: Bec1LibraryEncryptor;
}

export interface WithDecryptedSourceOptions {
  library: LibraryRecord;
  relativePath: string;
  encryptor: Bec1LibraryEncryptor;
  cacheDir: string;
  signal?: AbortSignal;
}

/** Saves one request body to a private temporary file for bounded processing. */
export const withUploadedBook = async <Value>(
  options: WithUploadedBookOptions,
  callback: (sourcePath: string, originalName: string) => Promise<Value>
): Promise<Value> => {
  const originalName = normalizeOriginalName(options.originalName);
  await mkdir(options.cacheDir, { recursive: true });
  const temporaryDir = await mkdtemp(join(options.cacheDir, "upload-"));
  const sourcePath = join(temporaryDir, `source${extname(originalName)}`);

  try {
    await writeReadableStream(sourcePath, options.body, options.signal);
    return await callback(sourcePath, originalName);
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
};

/** Encrypts and persists one supported file-backed book. */
export const importEncryptedBook = async (
  options: ImportEncryptedBookOptions
) => {
  assertEncryptedLibrary(options.library, options.encryptor);
  options.signal?.throwIfAborted();
  const scanned = await scanBookFile(options.sourcePath, {
    listPdfPages: listPdfPagesInChildProcess,
    signal: options.signal
  });

  if (!scanned) {
    throw Object.assign(new Error("Unsupported book format."), {
      code: "UNSUPPORTED_BOOK_FORMAT"
    });
  }

  const assetId = randomUUID();
  const relativePath = `${assetId}.bbec`;
  const encryptedPath = join(options.library.canonicalRootPath, relativePath);
  const sourceTitle = basename(options.sourcePath, extname(options.sourcePath));
  const originalTitle = basename(
    options.originalName,
    extname(options.originalName)
  );
  let book: ReturnType<typeof persistScannedBook>;

  try {
    await options.encryptor.encryptFile({
      assetId,
      inputPath: options.sourcePath,
      outputPath: encryptedPath,
      recovery: {
        originalName: options.originalName,
        mimeType: getBookSourceContentType(options.originalName),
        mediaKind: "book"
      }
    });
    options.signal?.throwIfAborted();
    book = persistScannedBook(options.database, {
      libraryId: options.library.id,
      relativePath,
      title: scanned.title === sourceTitle ? originalTitle : scanned.title,
      authors: scanned.authors,
      format: scanned.format,
      status: "ready",
      pageCount: scanned.pages.length,
      readingDirection: "rtl",
      size: scanned.size,
      mtimeMs: scanned.mtimeMs,
      fingerprint: scanned.fingerprint,
      pages: scanned.pages.map((page, pageIndex) => ({
        pageNumber: pageIndex + 1,
        sourceType: page.sourceType,
        relativePath,
        entryPath: page.entryPath ?? null,
        sourcePageNumber: page.sourcePageNumber ?? null,
        width: page.width ?? null,
        height: page.height ?? null,
        mimeType: page.mimeType ?? null
      }))
    });
  } catch (error) {
    await unlink(encryptedPath).catch(() => undefined);
    throw error;
  }

  if (options.thumbnailsEnabled && scanned.pages[0]) {
    try {
      const cover = await readPlaintextPage(
        options.sourcePath,
        scanned.pages[0],
        options.signal
      );
      await generateBookThumbnail({
        database: options.database,
        libraryId: options.library.id,
        bookId: book.id,
        sourceData: cover ?? undefined,
        thumbnailDir: options.thumbnailDir,
        page: 1,
        signal: options.signal
      });
    } catch {
      // A failed optional thumbnail never invalidates the encrypted book.
    }
  }

  return findBookDetail(options.database, options.library.id, book.id);
};

/** Streams one encrypted original using authenticated BEC1 byte ranges. */
export const createEncryptedSourceResponse = async (
  options: EncryptedSourceResponseOptions
): Promise<Response> => {
  assertEncryptedLibrary(options.library, options.encryptor);
  const container = await options.encryptor.openFile(
    resolveEncryptedAssetPath(options.library, options.relativePath)
  );
  const originalName = normalizeOriginalName(container.manifest.originalName);

  return createIterableResponse({
    request: options.request,
    size: container.info.plaintextSize,
    etag: `"bec1-${container.info.assetId}-${container.info.generation}"`,
    contentType:
      container.manifest.mimeType ?? getBookSourceContentType(originalName),
    cacheControl: "private, no-cache",
    dispositionFileName: originalName,
    iterate: (range) => container.iterateRange(range),
    close: () => container.close()
  });
};

/** Decrypts one asset into a mode-0600 temporary file for format adapters. */
export const withDecryptedSource = async <Value>(
  options: WithDecryptedSourceOptions,
  callback: (sourcePath: string) => Promise<Value>
): Promise<Value> => {
  assertEncryptedLibrary(options.library, options.encryptor);
  const container = await options.encryptor.openFile(
    resolveEncryptedAssetPath(options.library, options.relativePath)
  );
  await mkdir(options.cacheDir, { recursive: true });
  const temporaryDir = await mkdtemp(join(options.cacheDir, "plaintext-"));
  const originalName = normalizeOriginalName(container.manifest.originalName);
  const sourcePath = join(temporaryDir, `source${extname(originalName)}`);

  try {
    await writeContainer(sourcePath, container, options.signal);
    return await callback(sourcePath);
  } finally {
    await container.close();
    await rm(temporaryDir, { recursive: true, force: true });
  }
};

const writeReadableStream = async (
  outputPath: string,
  source: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<void> => {
  const output = await open(outputPath, "wx", 0o600);
  const reader = source.getReader();

  try {
    for (;;) {
      signal?.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      await output.write(Buffer.from(part.value));
    }
    await output.sync();
  } finally {
    reader.releaseLock();
    await output.close();
  }
};

const writeContainer = async (
  outputPath: string,
  container: Bec1OpenContainer,
  signal?: AbortSignal
): Promise<void> => {
  const output = await open(outputPath, "wx", 0o600);

  try {
    for await (const part of container.iterateRange()) {
      signal?.throwIfAborted();
      await output.write(part);
    }
    await output.sync();
  } finally {
    await output.close();
  }
};

const readPlaintextPage = async (
  sourcePath: string,
  page: ScannedBookPage,
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
    return renderPdfPageImageInChildProcess(
      sourcePath,
      page.sourcePageNumber,
      {},
      signal
    );
  }

  if (page.sourceType === "epub-page" && page.sourcePageNumber) {
    return renderEpubPageImage(sourcePath, page.sourcePageNumber);
  }

  if (page.sourceType === "file") {
    return new Uint8Array(await readFile(sourcePath));
  }

  return null;
};

const normalizeOriginalName = (value: string): string => {
  const name = basename(value.trim());

  if (!name || name === "." || name.length > 255 || name.includes("\0")) {
    throw Object.assign(new Error("Original file name is invalid."), {
      code: "INVALID_INPUT"
    });
  }

  return name;
};

const assertEncryptedLibrary = (
  library: LibraryRecord,
  encryptor: Bec1LibraryEncryptor
): void => {
  if (library.kind !== "encrypted" || encryptor.libraryId !== library.id) {
    throw new Error("Encrypted library key does not match the library.");
  }
};

/** Resolves a stored encrypted asset without permitting a path escape. */
const resolveEncryptedAssetPath = (
  library: LibraryRecord,
  relativePath: string
): string => {
  const assetPath = resolve(library.canonicalRootPath, relativePath);
  const pathFromRoot = relative(library.canonicalRootPath, assetPath);

  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Encrypted asset path escaped its library root.");
  }

  return assetPath;
};

const getBookSourceContentType = (path: string): string => {
  const extension = extname(path).toLocaleLowerCase();

  if (extension === ".pdf") return "application/pdf";
  if (extension === ".epub") return "application/epub+zip";
  if (extension === ".rar" || extension === ".cbr") {
    return "application/vnd.rar";
  }
  if (extension === ".7z") return "application/x-7z-compressed";
  if (extension === ".zip" || extension === ".cbz") {
    return "application/zip";
  }
  return "application/octet-stream";
};
