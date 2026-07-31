/**
 * Runtime schemas shared by the Hono API and Nuxt client.
 */

import { z } from "zod";

import { scanFailureCodes, scanFailureKinds } from "@bookcafe/core";

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

export const bookSortSchema = z.enum([
  "title",
  "purchasedAt",
  "updatedAt",
  "lastReadAt"
]);

export const sortOrderSchema = z.enum(["asc", "desc"]);

export const readerModeSchema = z.enum(["paged", "vertical"]);

export const readingDirectionSchema = z.enum(["rtl", "ltr"]);

export const bindHostSchema = z.enum(["127.0.0.1", "0.0.0.0"]);

export const thumbnailSettingsSchema = z.object({
  enabled: z.boolean()
});

export const bookSummarySchema = z.object({
  id: z.string(),
  libraryId: z.string(),
  relativePath: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  format: bookFormatSchema,
  status: bookStatusSchema,
  readingStatus: readingStatusSchema,
  tags: z.array(z.string()),
  pageCount: z.number().int().positive(),
  currentPage: z.number().int().positive(),
  thumbnailUrl: z.string().nullable(),
  archivedAt: z.string().nullable()
});

export const bookDetailSchema = bookSummarySchema.extend({
  readingDirection: readingDirectionSchema,
  publisher: z.string().nullable(),
  isbn: z.string().nullable(),
  purchasedAt: z.string().nullable(),
  notes: z.string().nullable()
});

export const bookListResponseSchema = z.object({
  books: z.array(bookSummarySchema),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
  hasMore: z.boolean()
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
  ),
  sort: bookSortSchema.default("title"),
  order: sortOrderSchema.default("asc"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100)
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
  setupComplete: z.boolean()
});

export const apiErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "INVALID_SETUP_INPUT",
  "INVALID_CREDENTIALS",
  "INVALID_LIBRARY_PATH",
  "SETUP_LOCAL_ONLY",
  "SETUP_REQUIRED",
  "ALREADY_INITIALIZED",
  "SIGN_UP_DISABLED",
  "DATA_UNAVAILABLE",
  "LIBRARY_BUSY",
  "LIBRARY_NAME_CONFLICT",
  "LIBRARY_PATH_CONFLICT",
  "COLLECTION_NAME_CONFLICT",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "INTERNAL_ERROR"
]);

export const apiErrorResponseSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string()
});

export const initialSetupRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.]+$/),
  password: z.string().min(8).max(128)
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

export const librarySchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const libraryCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  rootPath: z.string().trim().min(1).max(32767)
});

export const libraryUpdateRequestSchema = libraryCreateRequestSchema
  .partial()
  .refine(
    (request) => request.name !== undefined || request.rootPath !== undefined,
    "At least one library field is required."
  );

export const libraryListResponseSchema = z.object({
  libraries: z.array(librarySchema)
});

export const collectionSchema = z.object({
  id: z.string(),
  libraryId: z.string(),
  name: z.string(),
  bookCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const collectionDetailSchema = collectionSchema.extend({
  books: z.array(bookSummarySchema)
});

export const collectionListResponseSchema = z.object({
  collections: z.array(collectionSchema)
});

export const collectionCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(100)
});

export const collectionUpdateRequestSchema = collectionCreateRequestSchema;

export const collectionBookCreateRequestSchema = z.object({
  bookId: z.string().trim().min(1)
});

export const collectionBookOrderRequestSchema = z.object({
  bookIds: z.array(z.string().trim().min(1)).max(10000)
});

export const libraryPreferenceSchema = z.object({
  libraryId: z.string().nullable()
});

export const updateLibraryPreferenceRequestSchema = libraryPreferenceSchema;

export const jobTypeSchema = z.enum(["scan-library"]);

export const backgroundJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export const backgroundJobSchema = z.object({
  id: z.string(),
  libraryId: z.string(),
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

export const scanJobCreateRequestSchema = z.object({});

export const scanFailureCodeSchema = z.enum(scanFailureCodes);

export const scanFailureKindSchema = z.enum(scanFailureKinds);

export const scanFailureSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  kind: scanFailureKindSchema,
  relativePath: z.string(),
  format: bookFormatSchema,
  code: scanFailureCodeSchema,
  createdAt: z.string()
});

export const scanFailureListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100)
});

export const scanFailureListResponseSchema = z.object({
  failures: z.array(scanFailureSchema),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
  hasMore: z.boolean()
});

export const pageSourceTypeSchema = z.enum([
  "file",
  "archive-entry",
  "packed-archive-entry",
  "pdf-page",
  "epub-page"
]);

export const pageSchema = z.object({
  bookId: z.string(),
  pageNumber: z.number().int().positive(),
  sourceType: pageSourceTypeSchema,
  relativePath: z.string().nullable(),
  entryPath: z.string().nullable(),
  sourcePageNumber: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  mimeType: z.string().nullable(),
  createdAt: z.string()
});

export const pageListResponseSchema = z.object({
  pages: z.array(pageSchema)
});

export type BookListResponse = z.infer<typeof bookListResponseSchema>;
export type BookListQuery = z.input<typeof bookListQuerySchema>;
export type BookSort = z.infer<typeof bookSortSchema>;
export type SortOrder = z.infer<typeof sortOrderSchema>;
export type BookDetailResponse = z.infer<typeof bookDetailSchema>;
export type InitialSetupRequest = z.infer<typeof initialSetupRequestSchema>;
export type SetupStatusResponse = z.infer<typeof setupStatusSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
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
export type LibraryResponse = z.infer<typeof librarySchema>;
export type LibraryCreateRequest = z.infer<typeof libraryCreateRequestSchema>;
export type LibraryUpdateRequest = z.infer<typeof libraryUpdateRequestSchema>;
export type LibraryListResponse = z.infer<typeof libraryListResponseSchema>;
export type CollectionResponse = z.infer<typeof collectionSchema>;
export type CollectionDetailResponse = z.infer<typeof collectionDetailSchema>;
export type CollectionListResponse = z.infer<
  typeof collectionListResponseSchema
>;
export type CollectionCreateRequest = z.infer<
  typeof collectionCreateRequestSchema
>;
export type CollectionUpdateRequest = z.infer<
  typeof collectionUpdateRequestSchema
>;
export type CollectionBookCreateRequest = z.infer<
  typeof collectionBookCreateRequestSchema
>;
export type CollectionBookOrderRequest = z.infer<
  typeof collectionBookOrderRequestSchema
>;
export type LibraryPreferenceResponse = z.infer<typeof libraryPreferenceSchema>;
export type UpdateLibraryPreferenceRequest = z.infer<
  typeof updateLibraryPreferenceRequestSchema
>;
export type BackgroundJobResponse = z.infer<typeof backgroundJobSchema>;
export type BackgroundJobListResponse = z.infer<
  typeof backgroundJobListResponseSchema
>;
export type BackgroundJobCreateManyResponse = z.infer<
  typeof backgroundJobCreateManyResponseSchema
>;
export type ScanJobCreateRequest = z.infer<typeof scanJobCreateRequestSchema>;
export type ScanFailureCode = z.infer<typeof scanFailureCodeSchema>;
export type ScanFailureResponse = z.infer<typeof scanFailureSchema>;
export type ScanFailureListQuery = z.infer<typeof scanFailureListQuerySchema>;
export type ScanFailureListResponse = z.infer<
  typeof scanFailureListResponseSchema
>;
export type PageResponse = z.infer<typeof pageSchema>;
export type PageListResponse = z.infer<typeof pageListResponseSchema>;

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
