/**
 * Runtime schemas shared by the Hono API and Nuxt client.
 */

import { z } from "zod";

export const bookFormatSchema = z.enum([
  "image-folder",
  "zip",
  "cbz",
  "pdf",
  "epub",
  "rar",
  "cbr",
  "seven-zip",
  "unknown"
]);

export const bookStatusSchema = z.enum([
  "ready",
  "scanning",
  "missing",
  "error"
]);

export const readingStatusSchema = z.enum(["unread", "reading", "finished"]);

export const readerModeSchema = z.enum(["paged", "vertical"]);

export const readingDirectionSchema = z.enum(["rtl", "ltr"]);

export const bindHostSchema = z.enum(["127.0.0.1", "0.0.0.0"]);

export const thumbnailSettingsSchema = z.object({
  enabled: z.boolean()
});

export const bookSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  format: bookFormatSchema,
  status: bookStatusSchema,
  readingStatus: readingStatusSchema,
  tags: z.array(z.string()),
  pageCount: z.number().int().positive(),
  currentPage: z.number().int().positive(),
  thumbnailUrl: z.string().nullable()
});

export const bookDetailSchema = bookSummarySchema.extend({
  sourcePath: z.string(),
  readingDirection: readingDirectionSchema,
  publisher: z.string().nullable(),
  isbn: z.string().nullable(),
  purchasedAt: z.string().nullable(),
  notes: z.string().nullable()
});

export const bookListResponseSchema = z.object({
  books: z.array(bookSummarySchema)
});

export const bookListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  readingStatus: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length < 1 ? undefined : value,
    readingStatusSchema.optional()
  ),
  bookStatus: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length < 1 ? undefined : value,
    bookStatusSchema.optional()
  )
});

export const updateBookProgressRequestSchema = z.object({
  currentPage: z.number().int().positive()
});

export const updateBookMetadataRequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  authors: z.array(z.string().trim().min(1).max(200)).max(50),
  publisher: createNullableTrimmedStringSchema(200),
  isbn: createNullableTrimmedStringSchema(32),
  purchasedAt: createNullableDateSchema(),
  readingStatus: readingStatusSchema,
  tags: z.array(z.string().trim().min(1).max(64)).max(50),
  notes: createNullableTrimmedStringSchema(10000)
});

export const setupStatusSchema = z.object({
  setupComplete: z.boolean(),
  host: bindHostSchema,
  port: z.number().int().min(1).max(65535),
  thumbnails: thumbnailSettingsSchema
});

export const initialSetupRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(256),
  dataDir: z.string().min(1).optional(),
  host: bindHostSchema.default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(4510),
  thumbnails: thumbnailSettingsSchema.default({ enabled: true })
});

export const networkSettingsSchema = z.object({
  host: bindHostSchema,
  port: z.number().int().min(1).max(65535),
  restartRequired: z.boolean()
});

export const updateNetworkSettingsRequestSchema = z.object({
  host: bindHostSchema,
  port: z.number().int().min(1).max(65535)
});

export const updateThumbnailSettingsRequestSchema = thumbnailSettingsSchema;

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("bookcafe-server")
});

export const collectionRootSchema = z.object({
  id: z.string(),
  path: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const collectionRootCreateRequestSchema = z.object({
  path: z.string().min(1)
});

export const collectionRootListResponseSchema = z.object({
  roots: z.array(collectionRootSchema)
});

export const libraryExportResponseSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  collectionRoots: z.array(collectionRootSchema),
  books: z.array(bookDetailSchema)
});

export const jobTypeSchema = z.enum(["scan-collection-root"]);

export const backgroundJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export const backgroundJobSchema = z.object({
  id: z.string(),
  type: jobTypeSchema,
  status: backgroundJobStatusSchema,
  payload: z.unknown(),
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
  canCancel: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const backgroundJobListResponseSchema = z.object({
  jobs: z.array(backgroundJobSchema)
});

export const backgroundJobCreateManyResponseSchema = z.object({
  jobs: z.array(backgroundJobSchema)
});

export const scanJobCreateRequestSchema = z.object({
  collectionRootId: z.string().min(1)
});

export type BookListResponse = z.infer<typeof bookListResponseSchema>;
export type LibraryExportResponse = z.infer<typeof libraryExportResponseSchema>;
export type BookListQuery = z.infer<typeof bookListQuerySchema>;
export type BookDetailResponse = z.infer<typeof bookDetailSchema>;
export type InitialSetupRequest = z.infer<typeof initialSetupRequestSchema>;
export type SetupStatusResponse = z.infer<typeof setupStatusSchema>;
export type NetworkSettingsResponse = z.infer<typeof networkSettingsSchema>;
export type ThumbnailSettingsResponse = z.infer<typeof thumbnailSettingsSchema>;
export type UpdateNetworkSettingsRequest = z.infer<
  typeof updateNetworkSettingsRequestSchema
>;
export type UpdateThumbnailSettingsRequest = z.infer<
  typeof updateThumbnailSettingsRequestSchema
>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type UpdateBookProgressRequest = z.infer<
  typeof updateBookProgressRequestSchema
>;
export type UpdateBookMetadataRequest = z.infer<
  typeof updateBookMetadataRequestSchema
>;
export type CollectionRootResponse = z.infer<typeof collectionRootSchema>;
export type CollectionRootCreateRequest = z.infer<
  typeof collectionRootCreateRequestSchema
>;
export type CollectionRootListResponse = z.infer<
  typeof collectionRootListResponseSchema
>;
export type BackgroundJobResponse = z.infer<typeof backgroundJobSchema>;
export type BackgroundJobListResponse = z.infer<
  typeof backgroundJobListResponseSchema
>;
export type BackgroundJobCreateManyResponse = z.infer<
  typeof backgroundJobCreateManyResponseSchema
>;
export type ScanJobCreateRequest = z.infer<typeof scanJobCreateRequestSchema>;

/**
 * Creates a nullable string schema that trims non-empty values.
 */
function createNullableTrimmedStringSchema(maxLength: number) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length < 1 ? null : value,
    z.string().trim().max(maxLength).nullable()
  );
}

/**
 * Creates a nullable YYYY-MM-DD date schema for form inputs.
 */
function createNullableDateSchema() {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length < 1 ? null : value,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
  );
}
