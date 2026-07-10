/**
 * Drizzle schema and SQLite connection helpers for BookCafe.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { and, asc, count, desc, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  BookDetail,
  BookFormat,
  BookStatus,
  BookSummary,
  ReadingDirection,
  ReadingStatus
} from "@bookcafe/core";

export const collectionRoots = sqliteTable("collection_roots", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  collectionRootId: text("collection_root_id").references(
    () => collectionRoots.id
  ),
  title: text("title").notNull(),
  authorsJson: text("authors_json").notNull().default("[]"),
  publisher: text("publisher"),
  isbn: text("isbn"),
  purchasedAt: text("purchased_at"),
  readingStatus: text("reading_status").notNull().default("unread"),
  tagsJson: text("tags_json").notNull().default("[]"),
  notes: text("notes"),
  sourcePath: text("source_path").notNull().unique(),
  format: text("format").notNull(),
  status: text("status").notNull(),
  pageCount: integer("page_count").notNull(),
  currentPage: integer("current_page").notNull().default(1),
  readingDirection: text("reading_direction").notNull().default("rtl"),
  thumbnailPath: text("thumbnail_path"),
  size: integer("size"),
  mtimeMs: integer("mtime_ms"),
  fingerprint: text("fingerprint"),
  metadataEditedAt: integer("metadata_edited_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});

export const bookPages = sqliteTable("book_pages", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  sourcePath: text("source_path").notNull(),
  sourceType: text("source_type").notNull().default("file"),
  entryPath: text("entry_path"),
  width: integer("width"),
  height: integer("height"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull()
});

export const thumbnails = sqliteTable("thumbnails", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  page: integer("page").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull()
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  payload: text("payload").notNull(),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull()
});

export type CollectionRootRow = typeof collectionRoots.$inferSelect;
export type BookRow = typeof books.$inferSelect;
export type BookPageRow = typeof bookPages.$inferSelect;
export type ThumbnailRow = typeof thumbnails.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;

export type JobStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobType = "scan-collection-root";
export type CancelJobResult = "cancelled" | "not-found" | "not-cancellable";
export type DeleteCollectionRootResult = "deleted" | "not-found" | "has-books";
export type BookPageSourceType =
  "file" | "archive-entry" | "packed-archive-entry" | "pdf-page" | "epub-page";

export interface BookCafeDatabase {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle>;
}

export interface BookPageInput {
  pageNumber: number;
  sourcePath: string;
  sourceType?: BookPageSourceType;
  entryPath?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface PersistScannedBookInput {
  collectionRootId: string | null;
  title: string;
  authors?: string[];
  sourcePath: string;
  format: BookFormat;
  status?: BookStatus;
  pageCount: number;
  currentPage?: number;
  readingDirection?: ReadingDirection;
  thumbnailPath?: string | null;
  size?: number | null;
  mtimeMs?: number | null;
  fingerprint?: string | null;
  pages: BookPageInput[];
}

export interface UpdateBookMetadataInput {
  title: string;
  authors: string[];
  publisher: string | null;
  isbn: string | null;
  purchasedAt: string | null;
  readingStatus: ReadingStatus;
  tags: string[];
  notes: string | null;
}

export interface SetBookThumbnailInput {
  bookId: string;
  path: string;
  page: number;
  width: number;
  height: number;
}

export interface CreateJobInput {
  type: JobType;
  payload: unknown;
}

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: unknown;
  progress: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Opens a SQLite database and returns both the Drizzle client and raw handle.
 */
export const connectDatabase = (databasePath: string): BookCafeDatabase => {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");

  return {
    sqlite,
    db: drizzle(sqlite)
  };
};

/**
 * Creates or updates the current SQLite schema.
 */
export const migrateDatabase = (database: BookCafeDatabase): void => {
  database.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS collection_roots (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      collection_root_id TEXT REFERENCES collection_roots(id),
	      title TEXT NOT NULL,
	      authors_json TEXT NOT NULL DEFAULT '[]',
	      publisher TEXT,
	      isbn TEXT,
	      purchased_at TEXT,
	      reading_status TEXT NOT NULL DEFAULT 'unread',
	      tags_json TEXT NOT NULL DEFAULT '[]',
	      notes TEXT,
	      source_path TEXT NOT NULL UNIQUE,
	      format TEXT NOT NULL,
	      status TEXT NOT NULL,
      page_count INTEGER NOT NULL,
      current_page INTEGER NOT NULL DEFAULT 1,
      reading_direction TEXT NOT NULL DEFAULT 'rtl',
	      thumbnail_path TEXT,
	      size INTEGER,
	      mtime_ms INTEGER,
	      fingerprint TEXT,
	      metadata_edited_at INTEGER,
	      created_at INTEGER NOT NULL,
	      updated_at INTEGER NOT NULL
	    );

    CREATE TABLE IF NOT EXISTS book_pages (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      source_path TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'file',
      entry_path TEXT,
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(book_id, page_number)
    );

    CREATE TABLE IF NOT EXISTS thumbnails (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      page INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      generated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS books_collection_root_id_idx
      ON books(collection_root_id);
    CREATE INDEX IF NOT EXISTS book_pages_book_id_idx
      ON book_pages(book_id);
    CREATE INDEX IF NOT EXISTS thumbnails_book_id_idx
      ON thumbnails(book_id);
    CREATE INDEX IF NOT EXISTS jobs_status_idx
      ON jobs(status);
  `);

  addColumnIfMissing(
    database,
    "book_pages",
    "source_type",
    "TEXT NOT NULL DEFAULT 'file'"
  );
  addColumnIfMissing(database, "book_pages", "entry_path", "TEXT");
  addColumnIfMissing(database, "books", "publisher", "TEXT");
  addColumnIfMissing(database, "books", "isbn", "TEXT");
  addColumnIfMissing(database, "books", "purchased_at", "TEXT");
  addColumnIfMissing(
    database,
    "books",
    "reading_status",
    "TEXT NOT NULL DEFAULT 'unread'"
  );
  addColumnIfMissing(
    database,
    "books",
    "tags_json",
    "TEXT NOT NULL DEFAULT '[]'"
  );
  addColumnIfMissing(database, "books", "notes", "TEXT");
  addColumnIfMissing(database, "books", "fingerprint", "TEXT");
  addColumnIfMissing(database, "books", "metadata_edited_at", "INTEGER");
};

/**
 * Opens a database and ensures the schema exists.
 */
export const openBookCafeDatabase = (
  databasePath: string
): BookCafeDatabase => {
  const database = connectDatabase(databasePath);
  migrateDatabase(database);
  return database;
};

/**
 * Closes a BookCafe database connection.
 */
export const closeDatabase = (database: BookCafeDatabase): void => {
  database.sqlite.close();
};

/**
 * Creates a deterministic id for a source path.
 */
export const createBookId = (sourcePath: string): string =>
  createHash("sha1").update(resolve(sourcePath)).digest("hex").slice(0, 24);

/**
 * Inserts or updates a collection root path.
 */
export const upsertCollectionRoot = (
  database: BookCafeDatabase,
  path: string
): CollectionRootRow => {
  const now = new Date();
  const id = createBookId(path);
  const normalizedPath = resolve(path);

  database.db
    .insert(collectionRoots)
    .values({
      id,
      path: normalizedPath,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: collectionRoots.id,
      set: {
        path: normalizedPath,
        updatedAt: now
      }
    })
    .run();

  return findCollectionRoot(database, id) as CollectionRootRow;
};

/**
 * Lists configured collection roots in path order.
 */
export const listCollectionRoots = (
  database: BookCafeDatabase
): CollectionRootRow[] =>
  database.db
    .select()
    .from(collectionRoots)
    .orderBy(asc(collectionRoots.path))
    .all();

/**
 * Finds a collection root by id.
 */
export const findCollectionRoot = (
  database: BookCafeDatabase,
  id: string
): CollectionRootRow | null =>
  database.db
    .select()
    .from(collectionRoots)
    .where(eq(collectionRoots.id, id))
    .get() ?? null;

/**
 * Counts books currently associated with a collection root.
 */
export const countBooksForCollectionRoot = (
  database: BookCafeDatabase,
  collectionRootId: string
): number =>
  database.db
    .select({ value: count() })
    .from(books)
    .where(eq(books.collectionRootId, collectionRootId))
    .get()?.value ?? 0;

/**
 * Deletes an empty collection root without deleting or detaching books.
 */
export const deleteCollectionRoot = (
  database: BookCafeDatabase,
  id: string
): DeleteCollectionRootResult => {
  const root = findCollectionRoot(database, id);

  if (!root) {
    return "not-found";
  }

  if (countBooksForCollectionRoot(database, id) > 0) {
    return "has-books";
  }

  database.db.delete(collectionRoots).where(eq(collectionRoots.id, id)).run();
  return "deleted";
};

/**
 * Persists a scanned book and replaces its page list atomically.
 */
export const persistScannedBook = (
  database: BookCafeDatabase,
  input: PersistScannedBookInput
): BookDetail => {
  const now = new Date();
  const id = createBookId(input.sourcePath);
  const sourcePath = resolve(input.sourcePath);
  const existing = database.db
    .select()
    .from(books)
    .where(eq(books.id, id))
    .get();
  const scannedAuthorsJson = JSON.stringify(
    normalizeTextArray(input.authors ?? [])
  );
  const title = existing?.metadataEditedAt ? existing.title : input.title;
  const authorsJson = existing?.metadataEditedAt
    ? existing.authorsJson
    : scannedAuthorsJson;
  const currentPage = getRescannedCurrentPage(existing, input);
  const readingDirection = input.readingDirection ?? "rtl";
  const thumbnailPath =
    input.thumbnailPath === undefined
      ? (existing?.thumbnailPath ?? null)
      : input.thumbnailPath;

  database.db.transaction((transaction) => {
    transaction
      .insert(books)
      .values({
        id,
        collectionRootId: input.collectionRootId,
        title: input.title,
        authorsJson: scannedAuthorsJson,
        sourcePath,
        format: input.format,
        status: input.status ?? "ready",
        pageCount: input.pageCount,
        currentPage,
        readingDirection,
        thumbnailPath,
        size: input.size ?? null,
        mtimeMs: input.mtimeMs ?? null,
        fingerprint: input.fingerprint ?? null,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: books.id,
        set: {
          collectionRootId: input.collectionRootId,
          title,
          authorsJson,
          sourcePath,
          format: input.format,
          status: input.status ?? "ready",
          pageCount: input.pageCount,
          currentPage,
          readingDirection,
          thumbnailPath,
          size: input.size ?? null,
          mtimeMs: input.mtimeMs ?? null,
          fingerprint: input.fingerprint ?? null,
          updatedAt: now
        }
      })
      .run();

    transaction.delete(bookPages).where(eq(bookPages.bookId, id)).run();

    if (input.pages.length > 0) {
      transaction
        .insert(bookPages)
        .values(
          input.pages.map((page) => ({
            id: `${id}:${page.pageNumber}`,
            bookId: id,
            pageNumber: page.pageNumber,
            sourcePath: resolve(page.sourcePath),
            sourceType: page.sourceType ?? "file",
            entryPath: page.entryPath ?? null,
            width: page.width ?? null,
            height: page.height ?? null,
            createdAt: now
          }))
        )
        .run();
    }
  });

  return findBookDetail(database, id) as BookDetail;
};

/**
 * Marks books absent from the latest scan as missing for one collection root.
 */
export const markMissingBooksForCollectionRoot = (
  database: BookCafeDatabase,
  collectionRootId: string,
  activeSourcePaths: string[]
): number => {
  const activePaths = new Set(
    activeSourcePaths.map((sourcePath) => resolve(sourcePath))
  );
  const rows = database.db
    .select()
    .from(books)
    .where(eq(books.collectionRootId, collectionRootId))
    .all();
  const missingRows = rows.filter(
    (row) =>
      !activePaths.has(resolve(row.sourcePath)) && row.status !== "missing"
  );

  if (missingRows.length < 1) {
    return 0;
  }

  const now = new Date();

  database.db.transaction((transaction) => {
    for (const row of missingRows) {
      transaction
        .update(books)
        .set({
          status: "missing",
          updatedAt: now
        })
        .where(eq(books.id, row.id))
        .run();
    }
  });

  return missingRows.length;
};

/**
 * Lists persisted books as API summaries.
 */
export const listBookSummaries = (database: BookCafeDatabase): BookSummary[] =>
  database.db
    .select()
    .from(books)
    .orderBy(asc(books.title), asc(books.sourcePath))
    .all()
    .map(toBookSummary);

/**
 * Lists persisted books as API details for portable metadata export.
 */
export const listBookDetails = (database: BookCafeDatabase): BookDetail[] =>
  database.db
    .select()
    .from(books)
    .orderBy(asc(books.title), asc(books.sourcePath))
    .all()
    .map(toBookDetail);

/**
 * Searches persisted books by title, author metadata, or source path.
 */
export const searchBookSummaries = (
  database: BookCafeDatabase,
  query: string
): BookSummary[] => {
  const normalizedQuery = query.trim();

  if (normalizedQuery.length < 1) {
    return listBookSummaries(database);
  }

  const pattern = `%${normalizedQuery}%`;

  return database.db
    .select()
    .from(books)
    .where(
      or(
        like(books.title, pattern),
        like(books.authorsJson, pattern),
        like(books.publisher, pattern),
        like(books.isbn, pattern),
        like(books.tagsJson, pattern),
        like(books.notes, pattern),
        like(books.sourcePath, pattern)
      )
    )
    .orderBy(asc(books.title), asc(books.sourcePath))
    .all()
    .map(toBookSummary);
};

/**
 * Finds a persisted book by id.
 */
export const findBookDetail = (
  database: BookCafeDatabase,
  bookId: string
): BookDetail | null => {
  const row =
    database.db.select().from(books).where(eq(books.id, bookId)).get() ?? null;

  return row ? toBookDetail(row) : null;
};

/**
 * Finds a persisted page by book id and one-based page number.
 */
export const findBookPage = (
  database: BookCafeDatabase,
  bookId: string,
  pageNumber: number
): BookPageRow | null =>
  database.db
    .select()
    .from(bookPages)
    .where(
      and(eq(bookPages.bookId, bookId), eq(bookPages.pageNumber, pageNumber))
    )
    .get() ?? null;

/**
 * Finds the persisted thumbnail metadata for a book.
 */
export const findBookThumbnail = (
  database: BookCafeDatabase,
  bookId: string
): ThumbnailRow | null =>
  database.db
    .select()
    .from(thumbnails)
    .where(eq(thumbnails.bookId, bookId))
    .get() ?? null;

/**
 * Stores thumbnail metadata and exposes the thumbnail URL on the book.
 */
export const setBookThumbnail = (
  database: BookCafeDatabase,
  input: SetBookThumbnailInput
): BookDetail | null => {
  const existing = findBookDetail(database, input.bookId);

  if (!existing) {
    return null;
  }

  const now = new Date();
  const thumbnailPath = resolve(input.path);

  database.db.transaction((transaction) => {
    transaction
      .delete(thumbnails)
      .where(eq(thumbnails.bookId, input.bookId))
      .run();

    transaction
      .insert(thumbnails)
      .values({
        id: `${input.bookId}:${input.page}`,
        bookId: input.bookId,
        path: thumbnailPath,
        page: input.page,
        width: input.width,
        height: input.height,
        generatedAt: now
      })
      .run();

    transaction
      .update(books)
      .set({
        thumbnailPath,
        updatedAt: now
      })
      .where(eq(books.id, input.bookId))
      .run();
  });

  return findBookDetail(database, input.bookId);
};

/**
 * Updates the current page for a persisted book.
 */
export const updateBookCurrentPage = (
  database: BookCafeDatabase,
  bookId: string,
  currentPage: number
): BookDetail | null => {
  const existing = findBookDetail(database, bookId);

  if (!existing) {
    return null;
  }

  database.db
    .update(books)
    .set({
      currentPage: clampCurrentPage(currentPage, existing.pageCount),
      updatedAt: new Date()
    })
    .where(eq(books.id, bookId))
    .run();

  return findBookDetail(database, bookId);
};

/**
 * Updates user-editable book metadata without renaming source files.
 */
export const updateBookMetadata = (
  database: BookCafeDatabase,
  bookId: string,
  input: UpdateBookMetadataInput
): BookDetail | null => {
  const existing = findBookDetail(database, bookId);

  if (!existing) {
    return null;
  }

  const now = new Date();

  database.db
    .update(books)
    .set({
      title: input.title.trim(),
      authorsJson: JSON.stringify(normalizeTextArray(input.authors)),
      publisher: normalizeNullableText(input.publisher),
      isbn: normalizeNullableText(input.isbn),
      purchasedAt: normalizeNullableText(input.purchasedAt),
      readingStatus: input.readingStatus,
      tagsJson: JSON.stringify(normalizeTextArray(input.tags)),
      notes: normalizeNullableText(input.notes),
      metadataEditedAt: now,
      updatedAt: now
    })
    .where(eq(books.id, bookId))
    .run();

  return findBookDetail(database, bookId);
};

/**
 * Creates a queued background job.
 */
export const createJob = (
  database: BookCafeDatabase,
  input: CreateJobInput
): JobRecord => {
  const now = new Date();
  const id = randomUUID();

  database.db
    .insert(jobs)
    .values({
      id,
      type: input.type,
      status: "queued",
      payload: JSON.stringify(input.payload),
      progress: 0,
      error: null,
      createdAt: now,
      updatedAt: now
    })
    .run();

  return findJob(database, id) as JobRecord;
};

/**
 * Lists jobs in newest-first order.
 */
export const listJobs = (database: BookCafeDatabase): JobRecord[] =>
  database.db
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .all()
    .map(toJobRecord);

/**
 * Finds a background job by id.
 */
export const findJob = (
  database: BookCafeDatabase,
  jobId: string
): JobRecord | null => {
  const row =
    database.db.select().from(jobs).where(eq(jobs.id, jobId)).get() ?? null;

  return row ? toJobRecord(row) : null;
};

/**
 * Atomically cancels a queued or running job without changing terminal jobs.
 */
export const cancelJob = (
  database: BookCafeDatabase,
  jobId: string
): CancelJobResult => {
  const result = database.db
    .update(jobs)
    .set({
      status: "cancelled",
      error: null,
      updatedAt: new Date()
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])))
    .run();

  if (Number(result.changes) > 0) {
    return "cancelled";
  }

  return findJob(database, jobId) ? "not-cancellable" : "not-found";
};

/**
 * Marks a job as running.
 */
export const markJobRunning = (
  database: BookCafeDatabase,
  jobId: string
): JobRecord | null =>
  updateJob(database, jobId, "running", 5, null, ["queued"]);

/**
 * Marks a job as completed.
 */
export const markJobCompleted = (
  database: BookCafeDatabase,
  jobId: string
): JobRecord | null =>
  updateJob(database, jobId, "completed", 100, null, ["running"]);

/**
 * Marks a job as failed with an error message.
 */
export const markJobFailed = (
  database: BookCafeDatabase,
  jobId: string,
  error: string
): JobRecord | null =>
  updateJob(database, jobId, "failed", 100, error, ["queued", "running"]);

/**
 * Updates a job progress value without changing status.
 */
export const updateJobProgress = (
  database: BookCafeDatabase,
  jobId: string,
  progress: number
): JobRecord | null => {
  const existing = findJob(database, jobId);

  if (!existing) {
    return null;
  }

  database.db
    .update(jobs)
    .set({
      progress: Math.min(Math.max(Math.trunc(progress), 0), 100),
      updatedAt: new Date()
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
    .run();

  return findJob(database, jobId);
};

/**
 * Replaces a job payload while preserving its status and progress.
 */
export const updateJobPayload = (
  database: BookCafeDatabase,
  jobId: string,
  payload: unknown
): JobRecord | null => {
  const existing = findJob(database, jobId);

  if (!existing) {
    return null;
  }

  database.db
    .update(jobs)
    .set({
      payload: JSON.stringify(payload),
      updatedAt: new Date()
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
    .run();

  return findJob(database, jobId);
};

/**
 * Marks queued or running jobs as failed after an interrupted server process.
 */
export const markInterruptedJobsFailed = (
  database: BookCafeDatabase,
  error = "Job interrupted by server shutdown."
): number => {
  const interruptedRows = database.db
    .select()
    .from(jobs)
    .all()
    .filter((row) => row.status === "queued" || row.status === "running");

  if (interruptedRows.length < 1) {
    return 0;
  }

  const now = new Date();

  database.db.transaction((transaction) => {
    for (const row of interruptedRows) {
      transaction
        .update(jobs)
        .set({
          status: "failed",
          progress: 100,
          error,
          updatedAt: now
        })
        .where(eq(jobs.id, row.id))
        .run();
    }
  });

  return interruptedRows.length;
};

/**
 * Updates a job state.
 */
const updateJob = (
  database: BookCafeDatabase,
  jobId: string,
  status: JobStatus,
  progress: number,
  error: string | null,
  allowedStatuses: JobStatus[]
): JobRecord | null => {
  database.db
    .update(jobs)
    .set({
      status,
      progress,
      error,
      updatedAt: new Date()
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, allowedStatuses)))
    .run();

  return findJob(database, jobId);
};

/**
 * Converts a database book row into an API summary.
 */
const toBookSummary = (row: BookRow): BookSummary => ({
  id: row.id,
  title: row.title,
  authors: parseAuthors(row.authorsJson),
  format: row.format as BookFormat,
  status: row.status as BookStatus,
  readingStatus: parseReadingStatus(row.readingStatus),
  tags: parseTextArray(row.tagsJson),
  pageCount: row.pageCount,
  currentPage: row.currentPage,
  thumbnailUrl: row.thumbnailPath
    ? `/api/books/${encodeURIComponent(row.id)}/thumbnail`
    : null
});

/**
 * Converts a database book row into an API detail.
 */
const toBookDetail = (row: BookRow): BookDetail => ({
  ...toBookSummary(row),
  sourcePath: row.sourcePath,
  readingDirection: row.readingDirection === "ltr" ? "ltr" : "rtl",
  publisher: row.publisher,
  isbn: row.isbn,
  purchasedAt: row.purchasedAt,
  notes: row.notes
});

/**
 * Parses the serialized authors array.
 */
const parseAuthors = (value: string): string[] => {
  return parseTextArray(value);
};

/**
 * Parses a serialized string array.
 */
const parseTextArray = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
};

/**
 * Normalizes a persisted reading status value.
 */
const parseReadingStatus = (value: string): ReadingStatus => {
  if (value === "reading" || value === "finished") {
    return value;
  }

  return "unread";
};

/**
 * Normalizes user-editable text arrays while preserving first-seen order.
 */
const normalizeTextArray = (values: string[]): string[] => {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const normalizedValue = value.trim();

    if (normalizedValue.length < 1 || seen.has(normalizedValue)) {
      return [];
    }

    seen.add(normalizedValue);
    return [normalizedValue];
  });
};

/**
 * Converts blank user-editable text values to null.
 */
const normalizeNullableText = (value: string | null): string | null => {
  const normalizedValue = value?.trim() ?? "";

  return normalizedValue.length > 0 ? normalizedValue : null;
};

/**
 * Keeps reading progress stable when a scan refreshes an existing book.
 */
const getRescannedCurrentPage = (
  existing: BookRow | undefined,
  input: PersistScannedBookInput
): number =>
  clampCurrentPage(
    existing?.currentPage ?? input.currentPage ?? 1,
    input.pageCount
  );

/**
 * Clamps current page into the available persisted page range.
 */
const clampCurrentPage = (currentPage: number, pageCount: number): number => {
  const safePageCount = Math.max(Math.trunc(pageCount), 1);

  return Math.min(Math.max(Math.trunc(currentPage), 1), safePageCount);
};

/**
 * Converts a database job row into an API-safe job record.
 */
const toJobRecord = (row: JobRow): JobRecord => ({
  id: row.id,
  type: row.type as JobType,
  status: row.status as JobStatus,
  payload: JSON.parse(row.payload),
  progress: row.progress,
  error: row.error,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

/**
 * Adds a SQLite column when an older app database is missing it.
 */
const addColumnIfMissing = (
  database: BookCafeDatabase,
  tableName: string,
  columnName: string,
  definition: string
): void => {
  const rows = database.sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  database.sqlite.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
  );
};
