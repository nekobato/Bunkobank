/**
 * Format detection and image-folder helpers.
 */

import { createRequire } from "node:module";
import { open, readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";

import type { BookFormat } from "@bunkobank/core";
import { createCanvas } from "@napi-rs/canvas";
import { XMLParser } from "fast-xml-parser";
import { unzip } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ArchiveReader, libarchiveWasm } from "libarchive-wasm";

import type { PDFDocumentLoadingTask } from "pdfjs-dist/types/src/pdf.js";
import type { UnzipFileInfo, Unzipped } from "fflate";
import type { LibarchiveWasm } from "libarchive-wasm";

const imageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif"
]);

const archiveFormatByExtension = new Map<string, BookFormat>([
  [".zip", "zip"],
  [".cbz", "cbz"],
  [".rar", "rar"],
  [".cbr", "cbr"],
  [".7z", "seven-zip"]
]);

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});
const require = createRequire(import.meta.url);
const pdfjsPackageDir = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfCMapUrl = `${join(pdfjsPackageDir, "cmaps")}/`;
const pdfStandardFontDataUrl = `${join(pdfjsPackageDir, "standard_fonts")}/`;
const textDecoder = new TextDecoder("utf-8");
let libarchiveModulePromise: Promise<LibarchiveWasm> | null = null;
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  isArray: (tagName) =>
    tagName === "rootfile" || tagName === "item" || tagName === "itemref"
});
const epubImageWidth = 800;
const epubImageHeight = 1200;
const epubMargin = 72;
const epubFontSize = 30;
const epubLineHeight = 1.5;
const fileSignatureLength = 64;

export interface ArchiveImageEntry {
  entryPath: string;
  size: number;
}

export interface PdfPageEntry {
  pageNumber: number;
  width: number;
  height: number;
}

export interface RenderPdfPageImageOptions {
  scale?: number;
  maxDimension?: number;
}

export interface EpubPageEntry {
  pageNumber: number;
  width: number;
  height: number;
  sourceHref: string;
}

export interface BookSourceMetadata {
  title: string | null;
  authors: string[];
}

export interface RenderEpubPageImageOptions {
  width?: number;
  height?: number;
  margin?: number;
  fontSize?: number;
  lineHeight?: number;
}

interface EpubSpineDocument {
  href: string;
  text: string;
}

interface EpubPackageDocument {
  packageDir: string;
  packageRoot: Record<string, unknown>;
}

interface EpubPageRenderModel extends EpubPageEntry {
  lines: string[];
}

type PdfCanvasAndContext = {
  canvas: HTMLCanvasElement & {
    toBuffer: (type: "image/png") => Buffer;
  };
  context: CanvasRenderingContext2D;
};

type PdfCanvasFactory = {
  create: (width: number, height: number) => PdfCanvasAndContext;
  destroy?: (canvasAndContext: PdfCanvasAndContext) => void;
};

/**
 * Returns true when a path looks like a supported image file.
 */
export const isImageFile = (filePath: string): boolean =>
  imageExtensions.has(getExtension(filePath));

/**
 * Returns true when a path looks like an initially supported archive book.
 */
export const isZipBookFile = (filePath: string): boolean => {
  const format = detectFormat(filePath, false);
  return format === "zip" || format === "cbz";
};

/**
 * Returns true when a path looks like a RAR/CBR/7z archive book.
 */
export const isPackedArchiveBookFile = (filePath: string): boolean => {
  const format = detectFormat(filePath, false);
  return format === "rar" || format === "cbr" || format === "seven-zip";
};

/**
 * Returns true when a path looks like a PDF book.
 */
export const isPdfBookFile = (filePath: string): boolean =>
  detectFormat(filePath, false) === "pdf";

/**
 * Returns true when a path looks like an EPUB book.
 */
export const isEpubBookFile = (filePath: string): boolean =>
  detectFormat(filePath, false) === "epub";

/**
 * Detects the initial book format from a path and directory flag.
 */
export const detectFormat = (
  path: string,
  isDirectory: boolean
): BookFormat => {
  if (isDirectory) {
    return "image-folder";
  }

  const extension = getExtension(path);

  if (archiveFormatByExtension.has(extension)) {
    return archiveFormatByExtension.get(extension) ?? "unknown";
  }

  if (extension === ".pdf") {
    return "pdf";
  }

  if (extension === ".epub") {
    return "epub";
  }

  return "unknown";
};

/**
 * Detects a book format from extension and, when possible, file signatures.
 */
export const detectFileFormat = async (
  path: string,
  isDirectory: boolean
): Promise<BookFormat> => {
  const extensionFormat = detectFormat(path, isDirectory);

  if (isDirectory) {
    return extensionFormat;
  }

  const magicFormat = await detectMagicFormat(path);
  return resolveDetectedFormat(extensionFormat, magicFormat);
};

/**
 * Sorts page-like filenames in natural order.
 */
export const sortPageNames = (names: string[]): string[] =>
  [...names].sort((left, right) => collator.compare(left, right));

/**
 * Lists image entries inside a ZIP/CBZ archive in natural page order.
 */
export const listArchiveImageEntries = async (
  archivePath: string
): Promise<ArchiveImageEntry[]> => {
  const entries: ArchiveImageEntry[] = [];
  await readArchive(archivePath, (entry) => {
    const entryPath = normalizeArchiveEntryPath(entry.name);

    if (entryPath && isArchiveImageEntryPath(entryPath)) {
      entries.push({
        entryPath,
        size: entry.originalSize
      });
    }

    return false;
  });
  return sortArchiveImageEntries(entries);
};

/**
 * Reads one image entry from a ZIP/CBZ archive.
 */
export const readArchiveImageEntry = async (
  archivePath: string,
  entryPath: string
): Promise<Uint8Array | null> => {
  if (!isArchiveImageEntryPath(entryPath)) {
    return null;
  }

  const normalizedEntryPath = normalizeArchiveEntryPath(entryPath);

  if (!normalizedEntryPath) {
    return null;
  }

  const archive = await readArchive(
    archivePath,
    (entry) => normalizeArchiveEntryPath(entry.name) === normalizedEntryPath
  );
  return archive[normalizedEntryPath] ?? null;
};

/**
 * Lists image entries inside a RAR/CBR/7z archive in natural page order.
 */
export const listPackedArchiveImageEntries = async (
  archivePath: string
): Promise<ArchiveImageEntry[]> =>
  withPackedArchiveReader(archivePath, (reader) => {
    const entries: ArchiveImageEntry[] = [];

    for (;;) {
      const entry = reader.nextEntry();

      if (!entry) {
        break;
      }

      try {
        const entryPath = normalizeArchiveEntryPath(entry.getPathname());

        if (
          entry.getFiletype() === "File" &&
          entryPath &&
          isArchiveImageEntryPath(entryPath)
        ) {
          entries.push({
            entryPath,
            size: entry.getSize()
          });
        }
      } finally {
        entry.free();
      }
    }

    return sortArchiveImageEntries(entries);
  });

/**
 * Reads one image entry from a RAR/CBR/7z archive.
 */
export const readPackedArchiveImageEntry = async (
  archivePath: string,
  entryPath: string
): Promise<Uint8Array | null> => {
  const requestedPath = normalizeArchiveEntryPath(entryPath);

  if (!requestedPath || !isArchiveImageEntryPath(requestedPath)) {
    return null;
  }

  return withPackedArchiveReader(archivePath, (reader) => {
    for (;;) {
      const entry = reader.nextEntry();

      if (!entry) {
        break;
      }

      try {
        const currentPath = normalizeArchiveEntryPath(entry.getPathname());

        if (entry.getFiletype() === "File" && currentPath === requestedPath) {
          const data = entry.readData();
          return data ? new Uint8Array(data) : null;
        }
      } finally {
        entry.free();
      }
    }

    return null;
  });
};

/**
 * Lists pages inside a PDF with one-based page numbers and point dimensions.
 */
export const listPdfPages = async (pdfPath: string): Promise<PdfPageEntry[]> =>
  withPdfJsSecondaryRejectionGuard(async () => {
    const loadingTask = await createPdfLoadingTask(pdfPath);

    try {
      const document = await loadingTask.promise;
      const pages: PdfPageEntry[] = [];

      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        pages.push({
          pageNumber,
          width: Math.round(viewport.width),
          height: Math.round(viewport.height)
        });
        page.cleanup();
      }

      await document.cleanup();
      return pages;
    } finally {
      await destroyPdfLoadingTaskSafely(loadingTask);
    }
  });

/**
 * Renders one PDF page to PNG bytes for the page image API.
 */
export const renderPdfPageImage = async (
  pdfPath: string,
  pageNumber: number,
  options: RenderPdfPageImageOptions = {}
): Promise<Uint8Array | null> =>
  withPdfJsSecondaryRejectionGuard(async () => {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return null;
    }

    const loadingTask = await createPdfLoadingTask(pdfPath);

    try {
      const document = await loadingTask.promise;

      if (pageNumber > document.numPages) {
        await document.cleanup();
        return null;
      }

      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = calculatePdfRenderScale(baseViewport, options);
      const viewport = page.getViewport({ scale });
      const canvasFactory = document.canvasFactory as PdfCanvasFactory;
      const canvasAndContext = canvasFactory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height)
      );

      try {
        await page.render({
          canvas: canvasAndContext.canvas,
          canvasContext: canvasAndContext.context,
          viewport
        }).promise;

        return new Uint8Array(canvasAndContext.canvas.toBuffer("image/png"));
      } finally {
        page.cleanup();
        canvasFactory.destroy?.(canvasAndContext);
        await document.cleanup();
      }
    } finally {
      await destroyPdfLoadingTaskSafely(loadingTask);
    }
  });

/**
 * Lists generated fixed-viewport pages for an EPUB spine.
 */
export const listEpubPages = async (
  epubPath: string,
  options: RenderEpubPageImageOptions = {}
): Promise<EpubPageEntry[]> => {
  const publication = await readEpubSpineDocuments(epubPath);

  return paginateEpubDocuments(publication, options).map((page) => ({
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    sourceHref: page.sourceHref
  }));
};

/**
 * Renders one generated EPUB page to PNG bytes.
 */
export const renderEpubPageImage = async (
  epubPath: string,
  pageNumber: number,
  options: RenderEpubPageImageOptions = {}
): Promise<Uint8Array | null> => {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return null;
  }

  const publication = await readEpubSpineDocuments(epubPath);
  const pages = paginateEpubDocuments(publication, options);
  const page = pages.find((item) => item.pageNumber === pageNumber);

  if (!page) {
    return null;
  }

  const settings = getEpubRenderSettings(options);
  const canvas = createCanvas(settings.width, settings.height);
  const context = canvas.getContext("2d");
  const lineStep = Math.round(settings.fontSize * settings.lineHeight);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, settings.width, settings.height);
  context.fillStyle = "#1f2933";
  context.font = `${settings.fontSize}px sans-serif`;
  context.textBaseline = "top";

  for (const [index, line] of page.lines.entries()) {
    context.fillText(line, settings.margin, settings.margin + index * lineStep);
  }

  context.fillStyle = "#7b8794";
  context.font = `${Math.round(settings.fontSize * 0.6)}px sans-serif`;
  context.textAlign = "right";
  context.fillText(
    String(page.pageNumber),
    settings.width - settings.margin,
    settings.height - settings.margin / 2
  );

  return new Uint8Array(await canvas.encode("png"));
};

/**
 * Reads title and author metadata from an EPUB package document.
 */
export const readEpubMetadata = async (
  epubPath: string
): Promise<BookSourceMetadata> => {
  const publication = await readEpubPackageDocument(epubPath);
  const metadata = getObject(publication.packageRoot.metadata);
  const title = readFirstMetadataText(metadata, ["dc:title", "title"]);
  const authors = readMetadataTextList(metadata, ["dc:creator", "creator"]);

  return {
    title,
    authors
  };
};

/**
 * Returns a lower-case extension including the dot.
 */
export const getExtension = (filePath: string): string => {
  const lastSegment = filePath.split(/[\\/]/).at(-1) ?? filePath;
  const dotIndex = lastSegment.lastIndexOf(".");
  return dotIndex >= 0 ? lastSegment.slice(dotIndex).toLowerCase() : "";
};

/**
 * Reads a ZIP central directory and extracts only entries accepted by `filter`.
 * The compressed source remains one bounded input buffer because fflate's
 * random-access API consumes a Uint8Array, but unrelated entries are not
 * inflated into additional buffers.
 */
const readArchive = async (
  archivePath: string,
  filter?: (entry: UnzipFileInfo) => boolean
): Promise<Unzipped> => {
  const archive = await readFile(archivePath);
  return unzipArchive(archive, filter);
};

/**
 * Wraps fflate's callback-based unzip API in a Promise.
 */
const unzipArchive = (
  archive: Uint8Array,
  filter?: (entry: UnzipFileInfo) => boolean
): Promise<Unzipped> =>
  new Promise((resolve, reject) => {
    unzip(archive, filter ? { filter } : {}, (error, unzipped) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(unzipped);
    });
  });

/**
 * Detects formats that expose stable magic signatures.
 */
const detectMagicFormat = async (filePath: string): Promise<BookFormat> => {
  let signature: Uint8Array;

  try {
    signature = await readFileSignature(filePath);
  } catch {
    return "unknown";
  }

  if (startsWithBytes(signature, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "pdf";
  }

  if (startsWithBytes(signature, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return "seven-zip";
  }

  if (
    startsWithBytes(signature, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]) ||
    startsWithBytes(signature, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
  ) {
    return "rar";
  }

  if (isZipSignature(signature)) {
    return detectZipContainerFormat(filePath);
  }

  return "unknown";
};

/**
 * Reads the fixed-size leading signature bytes from a file.
 */
const readFileSignature = async (filePath: string): Promise<Uint8Array> => {
  const file = await open(filePath, "r");
  const buffer = Buffer.alloc(fileSignatureLength);

  try {
    const { bytesRead } = await file.read(buffer, 0, fileSignatureLength, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
};

/**
 * Detects ZIP-based container formats that need more than the generic ZIP magic.
 */
const detectZipContainerFormat = async (
  filePath: string
): Promise<BookFormat> => {
  try {
    const archive = await readArchive(
      filePath,
      (entry) => normalizeArchiveEntryPath(entry.name) === "mimetype"
    );
    const mimetype = archive.mimetype
      ? textDecoder.decode(archive.mimetype).trim()
      : "";

    return mimetype === "application/epub+zip" ? "epub" : "zip";
  } catch {
    return "zip";
  }
};

/**
 * Resolves extension and signature findings while preserving comic extensions.
 */
const resolveDetectedFormat = (
  extensionFormat: BookFormat,
  magicFormat: BookFormat
): BookFormat => {
  if (magicFormat === "unknown") {
    return extensionFormat;
  }

  if (magicFormat === "zip") {
    return extensionFormat === "cbz" || extensionFormat === "epub"
      ? extensionFormat
      : "zip";
  }

  if (magicFormat === "rar") {
    return extensionFormat === "cbr" ? "cbr" : "rar";
  }

  return magicFormat;
};

/**
 * Returns true when bytes have a known ZIP signature.
 */
const isZipSignature = (signature: Uint8Array): boolean =>
  startsWithBytes(signature, [0x50, 0x4b, 0x03, 0x04]) ||
  startsWithBytes(signature, [0x50, 0x4b, 0x05, 0x06]) ||
  startsWithBytes(signature, [0x50, 0x4b, 0x07, 0x08]);

/**
 * Returns true when a byte array begins with a target signature.
 */
const startsWithBytes = (bytes: Uint8Array, signature: number[]): boolean =>
  bytes.length >= signature.length &&
  signature.every((byte, index) => bytes[index] === byte);

/**
 * Opens a libarchive reader for archive formats not covered by fflate.
 */
const createPackedArchiveReader = async (
  archivePath: string
): Promise<ArchiveReader> => {
  const [archiveData, libarchiveModule] = await Promise.all([
    readFile(archivePath),
    loadLibarchiveModule()
  ]);

  const archiveView = new Int8Array(
    archiveData.buffer,
    archiveData.byteOffset,
    archiveData.byteLength
  );
  return new ArchiveReader(libarchiveModule, archiveView);
};

/**
 * Runs an operation with a libarchive reader and always releases WASM memory.
 */
const withPackedArchiveReader = async <T>(
  archivePath: string,
  callback: (reader: ArchiveReader) => T | Promise<T>
): Promise<T> => {
  const reader = await createPackedArchiveReader(archivePath);

  try {
    return await callback(reader);
  } finally {
    reader.free();
  }
};

/**
 * Loads the shared libarchive WASM module once per process.
 */
const loadLibarchiveModule = (): Promise<LibarchiveWasm> => {
  libarchiveModulePromise ??= libarchiveWasm();
  return libarchiveModulePromise;
};

/**
 * Sorts archive image entries by their normalized page path.
 */
const sortArchiveImageEntries = (
  entries: ArchiveImageEntry[]
): ArchiveImageEntry[] =>
  [...entries].sort((left, right) =>
    collator.compare(left.entryPath, right.entryPath)
  );

/**
 * Returns true when an archive entry should be treated as a page image.
 */
const isArchiveImageEntryPath = (entryPath: string): boolean => {
  const normalized = normalizeArchiveEntryPath(entryPath);

  if (!normalized) {
    return false;
  }

  const name = normalized.split("/").at(-1) ?? "";

  return (
    name.length > 0 &&
    !name.startsWith("._") &&
    !normalized.startsWith("__MACOSX/") &&
    isImageFile(normalized)
  );
};

/**
 * Creates a PDF.js loading task from filesystem bytes.
 */
const createPdfLoadingTask = async (
  pdfPath: string
): Promise<PDFDocumentLoadingTask> => {
  const loadingTask = getDocument({
    url: pathToFileURL(pdfPath),
    cMapUrl: pdfCMapUrl,
    cMapPacked: true,
    disableAutoFetch: true,
    disableStream: true,
    standardFontDataUrl: pdfStandardFontDataUrl,
    stopAtErrors: true
  });

  loadingTask.promise.catch(() => undefined);

  return loadingTask;
};

/**
 * Runs a PDF.js operation while suppressing known secondary XRef rejections.
 */
const withPdfJsSecondaryRejectionGuard = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const handleUnhandledRejection = (reason: unknown): void => {
    if (isPdfJsSecondaryRejection(reason)) {
      return;
    }

    throw toError(reason);
  };

  process.on("unhandledRejection", handleUnhandledRejection);

  try {
    return await operation();
  } finally {
    await waitForPendingPdfJsRejections();
    process.off("unhandledRejection", handleUnhandledRejection);
  }
};

/**
 * Returns true for PDF.js parse rejections that duplicate the handled error.
 */
const isPdfJsSecondaryRejection = (reason: unknown): boolean => {
  const message =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : String(reason);

  return (
    message.includes("XRefEntryException") ||
    message.includes("bad XRef entry") ||
    message.includes("Bad (uncompressed) XRef entry")
  );
};

/**
 * Converts an unknown rejected value into an Error for rethrowing.
 */
const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason));

/**
 * Lets PDF.js worker/fake-worker rejection notifications settle.
 */
const waitForPendingPdfJsRejections = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Destroys a PDF.js loading task without leaking secondary rejections.
 */
const destroyPdfLoadingTaskSafely = async (
  loadingTask: PDFDocumentLoadingTask
): Promise<void> => {
  try {
    await loadingTask.destroy();
  } catch {
    // A malformed PDF can reject while the primary parse error is already being handled.
  }
};

/**
 * Calculates a bounded render scale for PDF page images.
 */
const calculatePdfRenderScale = (
  viewport: { width: number; height: number },
  options: RenderPdfPageImageOptions
): number => {
  const requestedScale = options.scale ?? 2;
  const maxDimension = options.maxDimension ?? 2400;
  const boundedScale = maxDimension / Math.max(viewport.width, viewport.height);

  return Math.max(0.1, Math.min(requestedScale, boundedScale));
};

/**
 * Reads EPUB package data and returns text-bearing spine documents.
 */
const readEpubSpineDocuments = async (
  epubPath: string
): Promise<EpubSpineDocument[]> => {
  const publication = await readEpubPackageDocument(epubPath);
  const { packageDir, packageRoot } = publication;
  const manifest = asArray(getObject(packageRoot.manifest).item);
  const spine = asArray(getObject(packageRoot.spine).itemref);
  const manifestById = new Map(
    manifest.map((item) => [getString(getObject(item)["@_id"]), item])
  );
  const spineEntries = spine
    .map((itemref): { href: string } | null => {
      const item = getObject(
        manifestById.get(getString(getObject(itemref)["@_idref"]))
      );
      const mediaType = getString(item["@_media-type"]);

      if (!isEpubTextMediaType(mediaType)) {
        return null;
      }

      const href = resolveEpubEntryPath(packageDir, getString(item["@_href"]));

      if (!href) {
        return null;
      }

      return { href };
    })
    .filter((item): item is { href: string } => item !== null);
  const requestedEntries = new Set(spineEntries.map((entry) => entry.href));
  const archive = await readArchive(epubPath, (entry) => {
    const normalized = normalizeArchiveEntryPath(entry.name);
    return normalized ? requestedEntries.has(normalized) : false;
  });

  return spineEntries
    .map(({ href }): EpubSpineDocument | null => {
      const text = extractReadableText(
        parseXmlObject(readRequiredArchiveText(archive, href))
      );
      return text.length > 0 ? { href, text } : null;
    })
    .filter((item): item is EpubSpineDocument => item !== null);
};

/**
 * Reads the EPUB container and package document.
 */
const readEpubPackageDocument = async (
  epubPath: string
): Promise<EpubPackageDocument> => {
  const containerArchive = await readArchive(
    epubPath,
    (entry) =>
      normalizeArchiveEntryPath(entry.name) === "META-INF/container.xml"
  );
  const container = parseXmlObject(
    readRequiredArchiveText(containerArchive, "META-INF/container.xml")
  );
  const rootfile = asArray(
    getObject(getObject(container.container).rootfiles).rootfile
  )[0];
  const packagePath = normalizeArchiveEntryPath(
    getString(getObject(rootfile)["@_full-path"])
  );

  if (!packagePath) {
    throw new Error("EPUB package document is missing.");
  }

  const packageArchive = await readArchive(
    epubPath,
    (entry) => normalizeArchiveEntryPath(entry.name) === packagePath
  );
  const packageDocument = parseXmlObject(
    readRequiredArchiveText(packageArchive, packagePath)
  );
  const packageRoot = getObject(packageDocument.package);

  return {
    packageDir: posix.dirname(packagePath),
    packageRoot
  };
};

/**
 * Paginates spine text into deterministic fixed-viewport page models.
 */
const paginateEpubDocuments = (
  documents: EpubSpineDocument[],
  options: RenderEpubPageImageOptions
): EpubPageRenderModel[] => {
  const settings = getEpubRenderSettings(options);
  const charsPerLine = Math.max(
    12,
    Math.floor(
      (settings.width - settings.margin * 2) / (settings.fontSize * 0.56)
    )
  );
  const linesPerPage = Math.max(
    1,
    Math.floor(
      (settings.height - settings.margin * 2) /
        (settings.fontSize * settings.lineHeight)
    )
  );
  const pages: EpubPageRenderModel[] = [];

  for (const document of documents) {
    const lines = wrapText(document.text, charsPerLine);

    for (let index = 0; index < lines.length; index += linesPerPage) {
      pages.push({
        pageNumber: pages.length + 1,
        width: settings.width,
        height: settings.height,
        sourceHref: document.href,
        lines: lines.slice(index, index + linesPerPage)
      });
    }
  }

  return pages;
};

/**
 * Returns bounded EPUB page rendering settings.
 */
const getEpubRenderSettings = (options: RenderEpubPageImageOptions) => ({
  width: Math.max(320, Math.trunc(options.width ?? epubImageWidth)),
  height: Math.max(480, Math.trunc(options.height ?? epubImageHeight)),
  margin: Math.max(24, Math.trunc(options.margin ?? epubMargin)),
  fontSize: Math.max(12, Math.trunc(options.fontSize ?? epubFontSize)),
  lineHeight: Math.max(1.1, options.lineHeight ?? epubLineHeight)
});

/**
 * Wraps text into approximate fixed-width lines for server-side EPUB pages.
 */
const wrapText = (text: string, charsPerLine: number): string[] =>
  text
    .split(/\n{2,}/)
    .flatMap((paragraph) => wrapParagraph(paragraph.trim(), charsPerLine))
    .filter((line) => line.length > 0);

/**
 * Wraps a single paragraph by words with a long-word fallback.
 */
const wrapParagraph = (paragraph: string, charsPerLine: number): string[] => {
  if (paragraph.length === 0) {
    return [];
  }

  const words = paragraph.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > charsPerLine) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }

      for (let index = 0; index < word.length; index += charsPerLine) {
        lines.push(word.slice(index, index + charsPerLine));
      }
      continue;
    }

    const next = current.length === 0 ? word : `${current} ${word}`;

    if (next.length > charsPerLine) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
};

/**
 * Extracts human-readable text from a parsed XHTML-like object.
 */
const extractReadableText = (value: unknown): string =>
  collectText(value, null)
    .join("")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Recursively collects text while skipping non-content document regions.
 */
const collectText = (value: unknown, key: string | null): string[] => {
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectText(item, key));
  }

  if (!isRecord(value) || shouldSkipTextKey(key)) {
    return [];
  }

  return Object.entries(value).flatMap(([childKey, childValue]) => {
    if (childKey.startsWith("@_")) {
      return [];
    }

    const childText = collectText(childValue, childKey);

    return isBlockTextKey(childKey) && childText.length > 0
      ? ["\n", ...childText, "\n"]
      : childText;
  });
};

/**
 * Parses XML into a loose object model.
 */
const parseXmlObject = (xml: string): Record<string, unknown> => {
  const parsed = xmlParser.parse(xml);
  return isRecord(parsed) ? parsed : {};
};

/**
 * Reads a required archive text entry.
 */
const readRequiredArchiveText = (
  archive: Unzipped,
  entryPath: string
): string => {
  const normalized = normalizeArchiveEntryPath(entryPath);
  const data = normalized ? archive[normalized] : undefined;

  if (!data) {
    throw new Error(`EPUB entry is missing: ${entryPath}`);
  }

  return textDecoder.decode(data);
};

/**
 * Resolves an EPUB resource path relative to the package document.
 */
const resolveEpubEntryPath = (
  packageDir: string,
  href: string
): string | null => {
  const pathWithoutFragment = href.split("#")[0] ?? "";
  const decoded = decodeUriSafely(pathWithoutFragment);
  return normalizeArchiveEntryPath(posix.join(packageDir, decoded));
};

/**
 * Normalizes a ZIP entry path and rejects paths outside the archive root.
 */
const normalizeArchiveEntryPath = (entryPath: string): string | null => {
  const normalized = posix
    .normalize(entryPath.replaceAll("\\", "/"))
    .replace(/^\/+/, "");

  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("../")
  ) {
    return null;
  }

  return normalized;
};

/**
 * Decodes URL-style EPUB hrefs without failing on malformed escapes.
 */
const decodeUriSafely = (value: string): string => {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
};

/**
 * Returns true for spine resources this initial EPUB renderer can text-render.
 */
const isEpubTextMediaType = (mediaType: string): boolean =>
  mediaType === "application/xhtml+xml" ||
  mediaType === "text/html" ||
  mediaType === "application/x-dtbook+xml";

/**
 * Returns true for XHTML block-like elements.
 */
const isBlockTextKey = (key: string): boolean =>
  new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "body",
    "br",
    "dd",
    "div",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tr",
    "ul"
  ]).has(key);

/**
 * Returns true for elements that are not part of readable body text.
 */
const shouldSkipTextKey = (key: string | null): boolean =>
  key === "head" ||
  key === "script" ||
  key === "style" ||
  key === "metadata" ||
  key === "manifest" ||
  key === "spine";

/**
 * Converts possibly-single parsed XML nodes into arrays.
 */
const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

/**
 * Reads the first non-empty metadata value from preferred XML element names.
 */
const readFirstMetadataText = (
  metadata: Record<string, unknown>,
  keys: string[]
): string | null =>
  keys
    .flatMap((key) => readMetadataTextList(metadata, [key]))
    .find((value) => value.length > 0) ?? null;

/**
 * Reads non-empty metadata values from preferred XML element names.
 */
const readMetadataTextList = (
  metadata: Record<string, unknown>,
  keys: string[]
): string[] => {
  const seen = new Set<string>();
  const values = keys
    .flatMap((key) => asArray(metadata[key]))
    .map(readMetadataText)
    .filter((value) => value.length > 0);

  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });
};

/**
 * Reads display text from a metadata XML node.
 */
const readMetadataText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") {
    return normalizeMetadataText(String(value));
  }

  if (Array.isArray(value)) {
    return normalizeMetadataText(value.map(readMetadataText).join(" "));
  }

  if (!isRecord(value)) {
    return "";
  }

  const explicitText = getString(value["#text"]);

  if (explicitText.length > 0) {
    return normalizeMetadataText(explicitText);
  }

  return normalizeMetadataText(
    Object.entries(value)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, child]) => readMetadataText(child))
      .join(" ")
  );
};

/**
 * Normalizes metadata whitespace to a single display string.
 */
const normalizeMetadataText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

/**
 * Returns a plain object or an empty object.
 */
const getObject = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

/**
 * Returns a string value or an empty string.
 */
const getString = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/**
 * Returns true when a value is a non-array object.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
