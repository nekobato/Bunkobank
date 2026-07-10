/**
 * Thumbnail generation helpers for scanned BookCafe books.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { setBookThumbnail, type BookCafeDatabase } from "@bookcafe/db";
import sharp from "sharp";

const thumbnailWidth = 320;
const thumbnailHeight = 480;

export interface GenerateBookThumbnailOptions {
  database: BookCafeDatabase;
  bookId: string;
  sourcePath?: string;
  sourceData?: Uint8Array;
  thumbnailDir: string;
  page: number;
}

export interface GeneratedBookThumbnail {
  path: string;
  page: number;
  width: number;
  height: number;
}

/**
 * Generates a WebP cover thumbnail from a readable source image.
 */
export const generateBookThumbnail = async (
  options: GenerateBookThumbnailOptions
): Promise<GeneratedBookThumbnail> => {
  await mkdir(options.thumbnailDir, { recursive: true });

  const source = getSharpSource(options);
  const thumbnailPath = join(options.thumbnailDir, `${options.bookId}.webp`);
  const info = await sharp(source)
    .resize({
      width: thumbnailWidth,
      height: thumbnailHeight,
      fit: "cover"
    })
    .webp({ quality: 80 })
    .toFile(thumbnailPath);

  const width = info.width ?? thumbnailWidth;
  const height = info.height ?? thumbnailHeight;

  setBookThumbnail(options.database, {
    bookId: options.bookId,
    path: thumbnailPath,
    page: options.page,
    width,
    height
  });

  return {
    path: thumbnailPath,
    page: options.page,
    width,
    height
  };
};

/**
 * Returns the source input accepted by sharp.
 */
const getSharpSource = (
  options: GenerateBookThumbnailOptions
): string | Buffer => {
  if (options.sourcePath) {
    return options.sourcePath;
  }

  if (options.sourceData) {
    return Buffer.from(options.sourceData);
  }

  throw new Error("Thumbnail source is required.");
};
