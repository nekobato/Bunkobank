/**
 * HTTP byte-range parsing and bounded file/buffer response helpers.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/** A satisfiable inclusive byte range. */
export interface ByteRange {
  start: number;
  end: number;
}

/** Result of interpreting one HTTP Range header. */
export type ByteRangeResult =
  | { kind: "full" }
  | { kind: "partial"; range: ByteRange }
  | { kind: "unsatisfiable" };

/** Shared metadata for a binary response. */
export interface BinaryResponseOptions {
  request: Request;
  contentType: string;
  cacheControl?: string;
  dispositionFileName?: string;
}

/** Options for streaming a local file response. */
export interface FileResponseOptions extends BinaryResponseOptions {
  filePath: string;
}

/** Options for serving an in-memory binary response. */
export interface BufferResponseOptions extends BinaryResponseOptions {
  data: Uint8Array;
}

/**
 * Parses a single RFC 9110 bytes range for a representation of `size` bytes.
 * Unsupported units, malformed values, and multiple ranges are ignored, while
 * well-formed out-of-bounds byte ranges are rejected as unsatisfiable.
 */
export const parseByteRange = (
  rangeHeader: string | null,
  size: number
): ByteRangeResult => {
  if (!rangeHeader || !/^bytes=/i.test(rangeHeader)) {
    return { kind: "full" };
  }

  const value = rangeHeader.slice("bytes=".length).trim();

  if (!Number.isSafeInteger(size) || size < 0) {
    return { kind: "unsatisfiable" };
  }

  if (!value || value.includes(",")) {
    return { kind: "full" };
  }

  const match = /^(?<start>\d*)-(?<end>\d*)$/.exec(value);

  if (!match?.groups || (!match.groups.start && !match.groups.end)) {
    return { kind: "full" };
  }

  if (!match.groups.start) {
    const suffixLength = parseNonNegativeInteger(match.groups.end);

    if (suffixLength === null || suffixLength === 0 || size === 0) {
      return { kind: "unsatisfiable" };
    }

    return {
      kind: "partial",
      range: {
        start: Math.max(size - suffixLength, 0),
        end: size - 1
      }
    };
  }

  const start = parseNonNegativeInteger(match.groups.start);
  const requestedEnd = match.groups.end
    ? parseNonNegativeInteger(match.groups.end)
    : size - 1;

  if (start === null || requestedEnd === null) {
    return { kind: "full" };
  }

  if (start >= size) {
    return { kind: "unsatisfiable" };
  }

  if (requestedEnd < start) {
    return { kind: "full" };
  }

  return {
    kind: "partial",
    range: {
      start,
      end: Math.min(requestedEnd, size - 1)
    }
  };
};

/**
 * Streams a local file with single-range, HEAD, validator, and cancellation
 * support without buffering the complete file in application memory.
 */
export const createFileResponse = async ({
  request,
  filePath,
  contentType,
  cacheControl,
  dispositionFileName
}: FileResponseOptions): Promise<Response> => {
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error("Requested source is not a regular file.");
  }

  const headers = createBinaryHeaders({
    contentType,
    cacheControl,
    dispositionFileName
  });
  const etag = createFileEtag(fileStat.size, fileStat.mtimeMs);
  headers.set("ETag", etag);
  headers.set("Last-Modified", fileStat.mtime.toUTCString());
  const range =
    request.method === "GET" && shouldApplyRange(request, etag, fileStat.mtime)
      ? parseByteRange(request.headers.get("Range"), fileStat.size)
      : ({ kind: "full" } satisfies ByteRangeResult);

  if (range.kind === "unsatisfiable") {
    return createUnsatisfiableResponse(headers, fileStat.size);
  }

  if (range.kind === "partial") {
    const { start, end } = range.range;
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
    return new Response(
      request.method === "HEAD"
        ? null
        : toWebReadableStream(createReadStream(filePath, { start, end })),
      { status: 206, headers }
    );
  }

  headers.set("Content-Length", String(fileStat.size));
  return new Response(
    request.method === "HEAD"
      ? null
      : toWebReadableStream(createReadStream(filePath)),
    { status: 200, headers }
  );
};

/**
 * Serves already-produced bytes with the same range semantics as file
 * responses. This keeps generated PDF/EPUB/archive page assets protocol
 * compatible even when producing them still requires format-specific work.
 */
export const createBufferResponse = ({
  request,
  data,
  contentType,
  cacheControl,
  dispositionFileName
}: BufferResponseOptions): Response => {
  const headers = createBinaryHeaders({
    contentType,
    cacheControl,
    dispositionFileName
  });
  const range =
    request.method === "GET"
      ? parseByteRange(request.headers.get("Range"), data.byteLength)
      : ({ kind: "full" } satisfies ByteRangeResult);

  if (range.kind === "unsatisfiable") {
    return createUnsatisfiableResponse(headers, data.byteLength);
  }

  if (range.kind === "partial") {
    const { start, end } = range.range;
    const contentLength = end - start + 1;
    headers.set("Content-Length", String(contentLength));
    headers.set("Content-Range", `bytes ${start}-${end}/${data.byteLength}`);
    return new Response(
      request.method === "HEAD"
        ? null
        : toArrayBuffer(data.slice(start, end + 1)),
      { status: 206, headers }
    );
  }

  headers.set("Content-Length", String(data.byteLength));
  return new Response(request.method === "HEAD" ? null : toArrayBuffer(data), {
    status: 200,
    headers
  });
};

/**
 * Parses a decimal integer without permitting signs, fractions, or unsafe
 * values.
 */
const parseNonNegativeInteger = (value: string): number | null => {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

/**
 * Creates headers shared by full, partial, and unsatisfiable binary responses.
 */
const createBinaryHeaders = ({
  contentType,
  cacheControl,
  dispositionFileName
}: {
  contentType: string;
  cacheControl?: string;
  dispositionFileName?: string;
}): Headers => {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl ?? "private, no-cache",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff"
  });

  if (dispositionFileName) {
    headers.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeContentDispositionFilename(
        dispositionFileName
      )}`
    );
  }

  return headers;
};

/**
 * Returns whether a Range header should be honored under the request's
 * optional If-Range validator.
 */
const shouldApplyRange = (
  request: Request,
  etag: string,
  lastModified: Date
): boolean => {
  if (!request.headers.has("Range")) {
    return false;
  }

  const ifRange = request.headers.get("If-Range");

  if (!ifRange) {
    return true;
  }

  if (ifRange.startsWith('"')) {
    return ifRange === etag;
  }

  const ifRangeTime = Date.parse(ifRange);
  return (
    Number.isFinite(ifRangeTime) &&
    Math.trunc(lastModified.getTime() / 1000) === Math.trunc(ifRangeTime / 1000)
  );
};

/**
 * Creates a stable strong validator from the local file size and mtime.
 */
const createFileEtag = (size: number, mtimeMs: number): string =>
  `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;

/**
 * Creates a 416 response carrying the required unsatisfied Content-Range.
 */
const createUnsatisfiableResponse = (
  headers: Headers,
  size: number
): Response => {
  headers.set("Content-Length", "0");
  headers.set("Content-Range", `bytes */${size}`);
  return new Response(null, { status: 416, headers });
};

/**
 * Encodes a filename as an RFC 5987 attr-char value.
 */
const encodeContentDispositionFilename = (fileName: string): string =>
  encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );

/**
 * Converts a Node.js readable into a Fetch-compatible byte stream.
 */
const toWebReadableStream = (
  stream: ReturnType<typeof createReadStream>
): ReadableStream<Uint8Array> =>
  Readable.toWeb(stream) as ReadableStream<Uint8Array>;

/**
 * Copies an arbitrary ArrayBufferLike-backed view into a Fetch BodyInit-safe
 * ArrayBuffer.
 */
const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
  Uint8Array.from(data).buffer;
