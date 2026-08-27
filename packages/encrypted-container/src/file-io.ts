import { link, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { Bec1Error } from "./errors.js";

export const readExact = async (
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number
): Promise<Buffer> => {
  const result = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const part = await handle.read(
      result,
      read,
      length - read,
      position + read
    );
    if (part.bytesRead === 0) {
      throw new Bec1Error("INVALID_CONTAINER", "Unexpected end of file.");
    }
    read += part.bytesRead;
  }
  return result;
};

export const writeAll = async (
  handle: Awaited<ReturnType<typeof open>>,
  data: Uint8Array,
  position: number
): Promise<void> => {
  const source = Buffer.from(data);
  let written = 0;
  while (written < source.byteLength) {
    const part = await handle.write(
      source,
      written,
      source.byteLength - written,
      position + written
    );
    if (part.bytesWritten === 0) {
      throw new Bec1Error(
        "INVALID_CONTAINER",
        "Unable to make write progress."
      );
    }
    written += part.bytesWritten;
  }
};

export const withAtomicOutput = async <T>(
  outputPath: string,
  write: (temporaryPath: string) => Promise<T>
): Promise<T> => {
  const temporaryPath = join(
    dirname(outputPath),
    `.${randomUUID()}.bunkobank-part`
  );
  try {
    const result = await write(temporaryPath);
    try {
      await link(temporaryPath, outputPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Bec1Error(
          "OUTPUT_EXISTS",
          `Output already exists: ${outputPath}`,
          { cause: error }
        );
      }
      throw error;
    }
    return result;
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};
