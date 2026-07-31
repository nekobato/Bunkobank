/**
 * Single-SQLite persistence for BookCafe users, libraries, books, pages, and jobs.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import Database from "better-sqlite3";

import type {
  BookDetail,
  BookFormat,
  BookStatus,
  BookSummary,
  ReadingDirection,
  ReadingStatus,
  ScanFailureCode,
  ScanFailureKind
} from "@bookcafe/core";

export type JobStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobType = "scan-library";

export type BookSort = "title" | "purchasedAt" | "updatedAt" | "lastReadAt";

export type SortOrder = "asc" | "desc";

export type CancelJobResult = "cancelled" | "not-found" | "not-cancellable";

export type BookPageSourceType =
  "file" | "archive-entry" | "packed-archive-entry" | "pdf-page" | "epub-page";

export interface BookCafeDatabase {
  sqlite: Database.Database;
}

export interface LibraryRecord {
  id: string;
  name: string;
  rootPath: string;
  canonicalRootPath: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionRecord {
  id: string;
  libraryId: string;
  name: string;
  bookCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionDetailRecord extends CollectionRecord {
  books: BookSummary[];
}

export type AddCollectionBookResult =
  "added" | "already-present" | "book-unavailable" | "not-found";

export type ReorderCollectionBooksResult =
  "updated" | "order-mismatch" | "not-found";

export interface CreateLibraryInput {
  name: string;
  rootPath: string;
  canonicalRootPath: string;
}

export interface UpdateLibraryInput {
  name?: string;
  rootPath?: string;
  canonicalRootPath?: string;
}

export type UpdateLibraryResult = LibraryRecord | { status: "busy" } | null;

export type DeleteLibraryResult =
  | { status: "deleted"; thumbnailPaths: string[] }
  | { status: "busy" }
  | { status: "not-found" };

export interface BookPageInput {
  pageNumber: number;
  sourceType: BookPageSourceType;
  relativePath?: string | null;
  entryPath?: string | null;
  sourcePageNumber?: number | null;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
}

export interface BookPageRecord {
  bookId: string;
  pageNumber: number;
  sourceType: BookPageSourceType;
  relativePath: string | null;
  entryPath: string | null;
  sourcePageNumber: number | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  createdAt: Date;
}

export interface PersistScannedBookInput {
  libraryId: string;
  relativePath: string;
  title: string;
  authors?: string[];
  format: BookFormat;
  status?: BookStatus;
  pageCount: number;
  readingDirection?: ReadingDirection;
  size?: number | null;
  mtimeMs?: number | null;
  fingerprint?: string | null;
  scanId?: string | null;
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
  libraryId: string;
  bookId: string;
  path: string;
  page: number;
  width: number;
  height: number;
}

export interface CreateJobInput {
  libraryId: string;
  type: JobType;
  payload: unknown;
}

export interface JobRecord {
  id: string;
  libraryId: string;
  type: JobType;
  status: JobStatus;
  payload: unknown;
  progress: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScanFailureInput {
  jobId: string;
  kind: ScanFailureKind;
  relativePath: string;
  format: BookFormat;
  code: ScanFailureCode;
}

export interface ScanFailureRecord {
  id: string;
  jobId: string;
  kind: ScanFailureKind;
  relativePath: string;
  format: BookFormat;
  code: ScanFailureCode;
  createdAt: Date;
}

export interface ListScanFailuresOptions {
  offset?: number;
  limit?: number;
}

export interface ScanFailurePage {
  failures: ScanFailureRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface ListBookSummaryPageOptions {
  archived?: boolean;
  query?: string;
  readingStatus?: ReadingStatus;
  bookStatus?: BookStatus;
  offset?: number;
  limit?: number;
  userId?: string;
  sort?: BookSort;
  order?: SortOrder;
}

export interface BookSummaryPage {
  books: BookSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface ThumbnailRecord {
  id: string;
  libraryId: string;
  bookId: string;
  path: string;
  page: number;
  width: number;
  height: number;
  generatedAt: Date;
}

export interface BookCafeDomainError extends Error {
  code:
    | "LEGACY_DATABASE_UNSUPPORTED"
    | "LIBRARY_NAME_CONFLICT"
    | "LIBRARY_PATH_CONFLICT"
    | "COLLECTION_NAME_CONFLICT"
    | "INVALID_RELATIVE_PATH";
}

interface LibraryRow {
  id: string;
  name: string;
  root_path: string;
  canonical_root_path: string;
  created_at: number;
  updated_at: number;
}

interface BookRow {
  id: string;
  library_id: string;
  relative_path: string;
  title: string;
  authors_json: string;
  publisher: string | null;
  isbn: string | null;
  purchased_at: string | null;
  reading_status: string;
  tags_json: string;
  notes: string | null;
  format: string;
  status: string;
  page_count: number;
  reading_direction: string;
  size: number | null;
  mtime_ms: number | null;
  fingerprint: string | null;
  last_seen_scan_id: string | null;
  metadata_edited_at: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

interface BookPageRow {
  book_id: string;
  page_number: number;
  source_type: string;
  relative_path: string | null;
  entry_path: string | null;
  source_page_number: number | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  created_at: number;
}

interface ThumbnailRow {
  id: string;
  library_id: string;
  book_id: string;
  path: string;
  page: number;
  width: number;
  height: number;
  generated_at: number;
}

interface JobRow {
  id: string;
  library_id: string;
  type: string;
  status: string;
  payload: string;
  progress: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface ScanFailureRow {
  id: string;
  job_id: string;
  kind: string;
  relative_path: string;
  format: string;
  code: string;
  created_at: number;
}

interface CollectionRow {
  id: string;
  library_id: string;
  name: string;
  book_count: number;
  created_at: number;
  updated_at: number;
}

/**
 * Opens a SQLite handle with foreign keys and WAL enabled.
 */
export const connectDatabase = (databasePath: string): BookCafeDatabase => {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  return { sqlite };
};

/**
 * Creates the current single-database schema without transforming a legacy schema.
 */
export const migrateDatabase = (database: BookCafeDatabase): void => {
  if (
    tableExists(database, "collection_roots") &&
    !tableExists(database, "libraries")
  ) {
    throw createDomainError(
      "LEGACY_DATABASE_UNSUPPORTED",
      "The legacy Collection Root database must be reset before startup."
    );
  }

  database.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      root_path TEXT NOT NULL,
      canonical_root_path TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      title TEXT NOT NULL,
      authors_json TEXT NOT NULL DEFAULT '[]',
      publisher TEXT,
      isbn TEXT,
      purchased_at TEXT,
      reading_status TEXT NOT NULL DEFAULT 'unread'
        CHECK (reading_status IN ('unread', 'reading', 'finished')),
      tags_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      format TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('ready', 'scanning', 'missing', 'error')),
      page_count INTEGER NOT NULL CHECK (page_count > 0),
      reading_direction TEXT NOT NULL DEFAULT 'rtl'
        CHECK (reading_direction IN ('rtl', 'ltr')),
      size INTEGER,
      mtime_ms INTEGER,
      fingerprint TEXT,
      last_seen_scan_id TEXT,
      metadata_edited_at INTEGER,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (library_id, relative_path)
    );

    CREATE TABLE IF NOT EXISTS book_pages (
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL CHECK (page_number > 0),
      source_type TEXT NOT NULL
        CHECK (source_type IN (
          'file',
          'archive-entry',
          'packed-archive-entry',
          'pdf-page',
          'epub-page'
        )),
      relative_path TEXT,
      entry_path TEXT,
      source_page_number INTEGER,
      width INTEGER,
      height INTEGER,
      mime_type TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (book_id, page_number),
      CHECK (
        (source_type = 'file'
          AND relative_path IS NOT NULL
          AND entry_path IS NULL
          AND source_page_number IS NULL)
        OR
        (source_type IN ('archive-entry', 'packed-archive-entry')
          AND relative_path IS NOT NULL
          AND entry_path IS NOT NULL
          AND source_page_number IS NULL)
        OR
        (source_type IN ('pdf-page', 'epub-page')
          AND relative_path IS NOT NULL
          AND entry_path IS NULL
          AND source_page_number IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      current_page INTEGER NOT NULL CHECK (current_page > 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS thumbnails (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      page INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      generated_at INTEGER NOT NULL,
      UNIQUE (book_id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type = 'scan-library'),
      status TEXT NOT NULL
        CHECK (status IN (
          'queued',
          'running',
          'completed',
          'failed',
          'cancelled'
        )),
      payload TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0
        CHECK (progress >= 0 AND progress <= 100),
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_failures (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('book', 'subtree')),
      relative_path TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN (
        'image-folder',
        'zip',
        'cbz',
        'pdf',
        'epub',
        'rar',
        'cbr',
        'seven-zip',
        'unknown'
      )),
      code TEXT NOT NULL CHECK (code IN (
        'SOURCE_UNREADABLE',
        'DIRECTORY_UNREADABLE',
        'ARCHIVE_PARSE_FAILED',
        'EPUB_PARSE_FAILED',
        'PDF_APPLEDOUBLE_FILE',
        'PDF_INVALID_HEADER',
        'PDF_PARSE_FAILED',
        'PDF_PROCESS_TIMEOUT',
        'PDF_PROCESS_FAILED'
      )),
      created_at INTEGER NOT NULL,
      UNIQUE (job_id, kind, relative_path)
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      selected_library_id TEXT REFERENCES libraries(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (user_id, library_id, name)
    );

    CREATE TABLE IF NOT EXISTS collection_books (
      collection_id TEXT NOT NULL
        REFERENCES collections(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      added_at INTEGER NOT NULL,
      PRIMARY KEY (collection_id, book_id)
    );

    CREATE INDEX IF NOT EXISTS books_library_id_idx
      ON books(library_id);
    CREATE INDEX IF NOT EXISTS books_library_archive_idx
      ON books(library_id, archived_at);
    CREATE INDEX IF NOT EXISTS book_pages_book_id_idx
      ON book_pages(book_id);
    CREATE INDEX IF NOT EXISTS reading_progress_book_id_idx
      ON reading_progress(book_id);
    CREATE INDEX IF NOT EXISTS thumbnails_library_id_idx
      ON thumbnails(library_id);
    CREATE INDEX IF NOT EXISTS jobs_library_status_idx
      ON jobs(library_id, status);
    CREATE INDEX IF NOT EXISTS scan_failures_job_path_idx
      ON scan_failures(job_id, relative_path, kind);
    CREATE INDEX IF NOT EXISTS collections_user_library_idx
      ON collections(user_id, library_id, name);
    CREATE INDEX IF NOT EXISTS collection_books_order_idx
      ON collection_books(collection_id, position);
    CREATE INDEX IF NOT EXISTS collection_books_book_idx
      ON collection_books(book_id);
  `);

  addColumnIfMissing(database, "books", "last_seen_scan_id", "TEXT");
  database.sqlite.exec(`
    CREATE INDEX IF NOT EXISTS books_library_scan_idx
      ON books(library_id, last_seen_scan_id);
  `);
};

/**
 * Opens a database and ensures the current schema exists.
 */
export const openBookCafeDatabase = (
  databasePath: string
): BookCafeDatabase => {
  const database = connectDatabase(databasePath);

  try {
    migrateDatabase(database);
    return database;
  } catch (error) {
    closeDatabase(database);
    throw error;
  }
};

/**
 * Closes a BookCafe SQLite handle.
 */
export const closeDatabase = (database: BookCafeDatabase): void => {
  database.sqlite.close();
};

/**
 * Creates a named library with one canonical source root.
 */
export const createLibrary = (
  database: BookCafeDatabase,
  input: CreateLibraryInput
): LibraryRecord => {
  const name = normalizeRequiredText(input.name);
  const rootPath = resolve(input.rootPath);
  const canonicalRootPath = resolve(input.canonicalRootPath);

  assertLibraryNameAvailable(database, name);
  assertLibraryPathAvailable(database, canonicalRootPath);

  const now = Date.now();
  const id = randomUUID();

  database.sqlite
    .prepare(
      `INSERT INTO libraries (
        id,
        name,
        root_path,
        canonical_root_path,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, name, rootPath, canonicalRootPath, now, now);

  return findLibrary(database, id) as LibraryRecord;
};

/**
 * Lists libraries by case-insensitive display name.
 */
export const listLibraries = (database: BookCafeDatabase): LibraryRecord[] =>
  (
    database.sqlite
      .prepare("SELECT * FROM libraries ORDER BY name COLLATE NOCASE, id")
      .all() as LibraryRow[]
  ).map(toLibraryRecord);

/**
 * Finds a library by id.
 */
export const findLibrary = (
  database: BookCafeDatabase,
  libraryId: string
): LibraryRecord | null => {
  const row = database.sqlite
    .prepare("SELECT * FROM libraries WHERE id = ?")
    .get(libraryId) as LibraryRow | undefined;

  return row ? toLibraryRecord(row) : null;
};

/**
 * Updates a library name or root unless a scan is active.
 */
export const updateLibrary = (
  database: BookCafeDatabase,
  libraryId: string,
  input: UpdateLibraryInput
): UpdateLibraryResult => {
  const existing = findLibrary(database, libraryId);

  if (!existing) {
    return null;
  }

  if (hasActiveLibraryJobs(database, libraryId)) {
    return { status: "busy" };
  }

  const name =
    input.name === undefined
      ? existing.name
      : normalizeRequiredText(input.name);
  const rootPath =
    input.rootPath === undefined ? existing.rootPath : resolve(input.rootPath);
  const canonicalRootPath =
    input.canonicalRootPath === undefined
      ? input.rootPath === undefined
        ? existing.canonicalRootPath
        : resolve(input.rootPath)
      : resolve(input.canonicalRootPath);

  assertLibraryNameAvailable(database, name, libraryId);
  assertLibraryPathAvailable(database, canonicalRootPath, libraryId);

  database.sqlite
    .prepare(
      `UPDATE libraries
       SET name = ?, root_path = ?, canonical_root_path = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(name, rootPath, canonicalRootPath, Date.now(), libraryId);

  return findLibrary(database, libraryId);
};

/**
 * Deletes library-owned metadata and returns central thumbnail paths to unlink.
 */
export const deleteLibrary = (
  database: BookCafeDatabase,
  libraryId: string
): DeleteLibraryResult => {
  if (!findLibrary(database, libraryId)) {
    return { status: "not-found" };
  }

  if (hasActiveLibraryJobs(database, libraryId)) {
    return { status: "busy" };
  }

  const transaction = database.sqlite.transaction(() => {
    const thumbnailPaths = (
      database.sqlite
        .prepare(
          "SELECT path FROM thumbnails WHERE library_id = ? ORDER BY path"
        )
        .all(libraryId) as Array<{ path: string }>
    ).map(({ path }) => path);

    database.sqlite
      .prepare("DELETE FROM libraries WHERE id = ?")
      .run(libraryId);

    return thumbnailPaths;
  });

  return {
    status: "deleted",
    thumbnailPaths: transaction.immediate()
  };
};

/**
 * Creates a user-owned collection inside one library.
 */
export const createCollection = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  name: string
): CollectionRecord => {
  const normalizedName = normalizeRequiredText(name);
  assertCollectionNameAvailable(database, userId, libraryId, normalizedName);
  const id = randomUUID();
  const now = Date.now();

  database.sqlite
    .prepare(
      `INSERT INTO collections (
        id,
        user_id,
        library_id,
        name,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, libraryId, normalizedName, now, now);

  return findCollection(database, userId, libraryId, id) as CollectionRecord;
};

/**
 * Lists the current user's collections for one selected library.
 */
export const listCollections = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string
): CollectionRecord[] =>
  (
    database.sqlite
      .prepare(
        `SELECT
          collections.*,
          COUNT(
            CASE
              WHEN books.archived_at IS NULL AND books.status <> 'missing'
              THEN 1
            END
          ) AS book_count
         FROM collections
         LEFT JOIN collection_books
           ON collection_books.collection_id = collections.id
         LEFT JOIN books ON books.id = collection_books.book_id
         WHERE collections.user_id = ? AND collections.library_id = ?
         GROUP BY collections.id
         ORDER BY collections.name COLLATE NOCASE, collections.id`
      )
      .all(userId, libraryId) as CollectionRow[]
  ).map(toCollectionRecord);

/**
 * Finds one collection only inside its user and library ownership boundary.
 */
export const findCollection = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  collectionId: string
): CollectionRecord | null => {
  const row = database.sqlite
    .prepare(
      `SELECT
        collections.*,
        COUNT(
          CASE
            WHEN books.archived_at IS NULL AND books.status <> 'missing'
            THEN 1
          END
        ) AS book_count
       FROM collections
       LEFT JOIN collection_books
         ON collection_books.collection_id = collections.id
       LEFT JOIN books ON books.id = collection_books.book_id
       WHERE collections.id = ?
         AND collections.user_id = ?
         AND collections.library_id = ?
       GROUP BY collections.id`
    )
    .get(collectionId, userId, libraryId) as CollectionRow | undefined;

  return row ? toCollectionRecord(row) : null;
};

/**
 * Returns a collection with only currently visible member books.
 */
export const findCollectionDetail = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  collectionId: string
): CollectionDetailRecord | null => {
  const collection = findCollection(database, userId, libraryId, collectionId);

  if (!collection) {
    return null;
  }

  const rows = database.sqlite
    .prepare(
      `SELECT books.*
       FROM collection_books
       INNER JOIN books ON books.id = collection_books.book_id
       WHERE collection_books.collection_id = ?
         AND books.library_id = ?
         AND books.archived_at IS NULL
         AND books.status <> 'missing'
       ORDER BY collection_books.position, collection_books.added_at, books.id`
    )
    .all(collectionId, libraryId) as BookRow[];

  return {
    ...collection,
    books: rows.map((row) => toBookSummary(database, row, userId))
  };
};

/**
 * Renames one user-owned collection.
 */
export const updateCollection = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  collectionId: string,
  name: string
): CollectionRecord | null => {
  const existing = findCollection(database, userId, libraryId, collectionId);

  if (!existing) {
    return null;
  }

  const normalizedName = normalizeRequiredText(name);
  assertCollectionNameAvailable(
    database,
    userId,
    libraryId,
    normalizedName,
    collectionId
  );
  database.sqlite
    .prepare(
      `UPDATE collections
       SET name = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND library_id = ?`
    )
    .run(normalizedName, Date.now(), collectionId, userId, libraryId);

  return findCollection(database, userId, libraryId, collectionId);
};

/**
 * Deletes one collection without changing its source books.
 */
export const deleteCollection = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  collectionId: string
): boolean =>
  database.sqlite
    .prepare(
      `DELETE FROM collections
       WHERE id = ? AND user_id = ? AND library_id = ?`
    )
    .run(collectionId, userId, libraryId).changes > 0;

/**
 * Adds one available, same-library book at the end of a collection.
 */
export const addBookToCollection = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  collectionId: string,
  bookId: string
): AddCollectionBookResult => {
  if (!findCollection(database, userId, libraryId, collectionId)) {
    return "not-found";
  }

  const book = database.sqlite
    .prepare(
      `SELECT id
       FROM books
       WHERE id = ?
         AND library_id = ?
         AND archived_at IS NULL
         AND status <> 'missing'`
    )
    .get(bookId, libraryId) as { id: string } | undefined;

  if (!book) {
    return "book-unavailable";
  }

  const existing = database.sqlite
    .prepare(
      `SELECT 1
       FROM collection_books
       WHERE collection_id = ? AND book_id = ?`
    )
    .get(collectionId, bookId);

  if (existing) {
    return "already-present";
  }

  const transaction = database.sqlite.transaction(() => {
    const last = database.sqlite
      .prepare(
        `SELECT COALESCE(MAX(position), -1) AS position
         FROM collection_books
         WHERE collection_id = ?`
      )
      .get(collectionId) as { position: number };
    const now = Date.now();

    database.sqlite
      .prepare(
        `INSERT INTO collection_books (
          collection_id,
          book_id,
          position,
          added_at
        ) VALUES (?, ?, ?, ?)`
      )
      .run(collectionId, bookId, last.position + 1, now);
    database.sqlite
      .prepare("UPDATE collections SET updated_at = ? WHERE id = ?")
      .run(now, collectionId);
  });

  transaction.immediate();
  return "added";
};

/**
 * Removes one book membership and compacts the remaining manual order.
 */
export const removeBookFromCollection = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  collectionId: string,
  bookId: string
): boolean => {
  if (!findCollection(database, userId, libraryId, collectionId)) {
    return false;
  }

  const transaction = database.sqlite.transaction(() => {
    const removed = database.sqlite
      .prepare(
        `DELETE FROM collection_books
         WHERE collection_id = ? AND book_id = ?`
      )
      .run(collectionId, bookId);

    if (removed.changes < 1) {
      return false;
    }

    compactCollectionBookPositions(database, collectionId);
    database.sqlite
      .prepare("UPDATE collections SET updated_at = ? WHERE id = ?")
      .run(Date.now(), collectionId);
    return true;
  });

  return transaction.immediate();
};

/**
 * Replaces the visible member order while retaining hidden memberships.
 */
export const reorderCollectionBooks = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  collectionId: string,
  bookIds: readonly string[]
): ReorderCollectionBooksResult => {
  if (!findCollection(database, userId, libraryId, collectionId)) {
    return "not-found";
  }

  const rows = database.sqlite
    .prepare(
      `SELECT
        collection_books.book_id,
        books.archived_at,
        books.status
       FROM collection_books
       INNER JOIN books ON books.id = collection_books.book_id
       WHERE collection_books.collection_id = ?
       ORDER BY collection_books.position, collection_books.added_at`
    )
    .all(collectionId) as Array<{
    book_id: string;
    archived_at: number | null;
    status: string;
  }>;
  const visibleBookIds = rows
    .filter(
      ({ archived_at, status }) => archived_at === null && status !== "missing"
    )
    .map(({ book_id }) => book_id);
  const requestedIds = new Set(bookIds);

  if (
    requestedIds.size !== bookIds.length ||
    bookIds.length !== visibleBookIds.length ||
    visibleBookIds.some((bookId) => !requestedIds.has(bookId))
  ) {
    return "order-mismatch";
  }

  const hiddenBookIds = rows
    .filter(
      ({ archived_at, status }) => archived_at !== null || status === "missing"
    )
    .map(({ book_id }) => book_id);
  const transaction = database.sqlite.transaction(() => {
    const updatePosition = database.sqlite.prepare(
      `UPDATE collection_books
       SET position = ?
       WHERE collection_id = ? AND book_id = ?`
    );

    [...bookIds, ...hiddenBookIds].forEach((bookId, position) =>
      updatePosition.run(position, collectionId, bookId)
    );
    database.sqlite
      .prepare("UPDATE collections SET updated_at = ? WHERE id = ?")
      .run(Date.now(), collectionId);
  });

  transaction.immediate();
  return "updated";
};

/**
 * Persists one scanned book and replaces its page snapshot atomically.
 */
export const persistScannedBook = (
  database: BookCafeDatabase,
  input: PersistScannedBookInput
): BookDetail => {
  const relativePath = normalizeRelativePath(input.relativePath, true);
  const existing = findBookRowByRelativePath(
    database,
    input.libraryId,
    relativePath
  );

  if (existing?.archived_at) {
    return toBookDetail(database, existing);
  }

  const now = Date.now();
  const id = existing?.id ?? randomUUID();
  const metadataEdited = existing?.metadata_edited_at != null;
  const title = metadataEdited
    ? existing.title
    : normalizeRequiredText(input.title);
  const authorsJson = metadataEdited
    ? existing.authors_json
    : JSON.stringify(normalizeTextArray(input.authors ?? []));
  const pageCount = Math.max(1, Math.trunc(input.pageCount));
  const pages = input.pages.map(normalizeBookPageInput);
  const transaction = database.sqlite.transaction(() => {
    database.sqlite
      .prepare(
        `INSERT INTO books (
          id,
          library_id,
          relative_path,
          title,
          authors_json,
          format,
          status,
          page_count,
          reading_direction,
          size,
          mtime_ms,
          fingerprint,
          last_seen_scan_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (library_id, relative_path) DO UPDATE SET
          title = excluded.title,
          authors_json = excluded.authors_json,
          format = excluded.format,
          status = excluded.status,
          page_count = excluded.page_count,
          reading_direction = excluded.reading_direction,
          size = excluded.size,
          mtime_ms = excluded.mtime_ms,
          fingerprint = excluded.fingerprint,
          last_seen_scan_id = excluded.last_seen_scan_id,
          updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.libraryId,
        relativePath,
        title,
        authorsJson,
        input.format,
        input.status ?? "ready",
        pageCount,
        input.readingDirection ?? existing?.reading_direction ?? "rtl",
        input.size ?? null,
        input.mtimeMs ?? null,
        input.fingerprint ?? null,
        input.scanId ?? null,
        existing?.created_at ?? now,
        now
      );

    database.sqlite.prepare("DELETE FROM book_pages WHERE book_id = ?").run(id);

    const insertPage = database.sqlite.prepare(
      `INSERT INTO book_pages (
        book_id,
        page_number,
        source_type,
        relative_path,
        entry_path,
        source_page_number,
        width,
        height,
        mime_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const page of pages) {
      insertPage.run(
        id,
        page.pageNumber,
        page.sourceType,
        page.relativePath,
        page.entryPath,
        page.sourcePageNumber,
        page.width,
        page.height,
        page.mimeType,
        now
      );
    }

    database.sqlite
      .prepare(
        `UPDATE reading_progress
         SET current_page = MIN(current_page, ?), updated_at = ?
         WHERE book_id = ? AND current_page > ?`
      )
      .run(pageCount, now, id, pageCount);
  });

  transaction.immediate();

  return findBookDetail(database, input.libraryId, id) as BookDetail;
};

/**
 * Marks non-archived books absent from a completed library scan as missing.
 */
export const markMissingBooksForLibrary = (
  database: BookCafeDatabase,
  libraryId: string,
  activeRelativePaths: readonly string[]
): number => {
  const activePaths = new Set(
    activeRelativePaths.map((path) => normalizeRelativePath(path, true))
  );
  const rows = database.sqlite
    .prepare(
      `SELECT id, relative_path
       FROM books
       WHERE library_id = ?
         AND archived_at IS NULL
         AND status <> 'missing'`
    )
    .all(libraryId) as Array<{ id: string; relative_path: string }>;
  const missingIds = rows
    .filter((row) => !activePaths.has(row.relative_path))
    .map((row) => row.id);

  if (missingIds.length === 0) {
    return 0;
  }

  const update = database.sqlite.prepare(
    "UPDATE books SET status = 'missing', updated_at = ? WHERE id = ?"
  );
  const transaction = database.sqlite.transaction(() => {
    const now = Date.now();

    for (const id of missingIds) {
      update.run(now, id);
    }
  });

  transaction.immediate();
  return missingIds.length;
};

/**
 * Marks visible books not stamped by one completed scan as missing.
 */
export const markBooksMissingAfterScan = (
  database: BookCafeDatabase,
  libraryId: string,
  scanId: string
): number =>
  database.sqlite
    .prepare(
      `UPDATE books
       SET status = 'missing', updated_at = ?
       WHERE library_id = ?
         AND archived_at IS NULL
         AND status <> 'missing'
         AND last_seen_scan_id IS NOT ?`
    )
    .run(Date.now(), libraryId, normalizeRequiredText(scanId)).changes;

/**
 * Marks one visible existing book as unreadable while preserving its snapshot.
 */
export const markBookScanError = (
  database: BookCafeDatabase,
  libraryId: string,
  relativePath: string,
  scanId?: string
): boolean =>
  database.sqlite
    .prepare(
      `UPDATE books
       SET status = 'error',
           last_seen_scan_id = COALESCE(?, last_seen_scan_id),
           updated_at = ?
       WHERE library_id = ?
         AND relative_path = ?
         AND archived_at IS NULL`
    )
    .run(
      scanId ?? null,
      Date.now(),
      libraryId,
      normalizeRelativePath(relativePath, true)
    ).changes > 0;

/**
 * Lists visible books for one library and optional user.
 */
export const listBookSummaries = (
  database: BookCafeDatabase,
  libraryId: string,
  userId?: string
): BookSummary[] =>
  listBookRows(database, libraryId, false).map((row) =>
    toBookSummary(database, row, userId)
  );

/**
 * Lists archived books for one library and optional user.
 */
export const listArchivedBookSummaries = (
  database: BookCafeDatabase,
  libraryId: string,
  userId?: string
): BookSummary[] =>
  listBookRows(database, libraryId, true).map((row) =>
    toBookSummary(database, row, userId)
  );

/**
 * Lists one database-bounded page of filtered book summaries.
 */
export const listBookSummaryPage = (
  database: BookCafeDatabase,
  libraryId: string,
  options: ListBookSummaryPageOptions = {}
): BookSummaryPage => {
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 100);
  const conditions = [
    "books.library_id = @libraryId",
    `books.archived_at IS ${options.archived ? "NOT NULL" : "NULL"}`
  ];
  const parameters: Record<string, string | number> = {
    libraryId,
    userId: options.userId ?? ""
  };
  const normalizedQuery = options.query?.trim() ?? "";

  if (normalizedQuery) {
    conditions.push(
      `(
        books.title LIKE @query
        OR books.authors_json LIKE @query
        OR books.publisher LIKE @query
        OR books.isbn LIKE @query
        OR books.tags_json LIKE @query
        OR books.notes LIKE @query
        OR books.relative_path LIKE @query
      )`
    );
    parameters.query = `%${normalizedQuery}%`;
  }

  if (options.readingStatus) {
    conditions.push("books.reading_status = @readingStatus");
    parameters.readingStatus = options.readingStatus;
  }

  if (options.bookStatus) {
    conditions.push("books.status = @bookStatus");
    parameters.bookStatus = options.bookStatus;
  }

  const whereClause = conditions.join("\n AND ");
  const fromClause = `books
    LEFT JOIN reading_progress AS progress
      ON progress.book_id = books.id AND progress.user_id = @userId`;
  const orderClause = getBookOrderClause(
    options.sort ?? "title",
    options.order ?? "asc"
  );
  const totalRow = database.sqlite
    .prepare(`SELECT COUNT(*) AS total FROM ${fromClause} WHERE ${whereClause}`)
    .get(parameters) as { total: number };
  const rows = database.sqlite
    .prepare(
      `SELECT books.*
       FROM ${fromClause}
       WHERE ${whereClause}
       ORDER BY ${orderClause}
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...parameters, limit, offset }) as BookRow[];
  const total = totalRow.total;

  return {
    books: rows.map((row) => toBookSummary(database, row, options.userId)),
    total,
    offset,
    limit,
    hasMore: offset + limit < total
  };
};

/**
 * Lists archived source locators so scanners can skip them before parsing.
 */
export const listArchivedRelativePaths = (
  database: BookCafeDatabase,
  libraryId: string
): string[] =>
  (
    database.sqlite
      .prepare(
        `SELECT relative_path
         FROM books
         WHERE library_id = ? AND archived_at IS NOT NULL
         ORDER BY relative_path`
      )
      .all(libraryId) as Array<{ relative_path: string }>
  ).map((row) => row.relative_path);

/**
 * Searches visible books within one library.
 */
export const searchBookSummaries = (
  database: BookCafeDatabase,
  libraryId: string,
  query: string,
  userId?: string
): BookSummary[] => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return listBookSummaries(database, libraryId, userId);
  }

  const pattern = `%${normalizedQuery}%`;
  const rows = database.sqlite
    .prepare(
      `SELECT *
       FROM books
       WHERE library_id = ?
         AND archived_at IS NULL
         AND (
           title LIKE ?
           OR authors_json LIKE ?
           OR publisher LIKE ?
           OR isbn LIKE ?
           OR tags_json LIKE ?
           OR notes LIKE ?
           OR relative_path LIKE ?
         )
       ORDER BY title COLLATE NOCASE, relative_path`
    )
    .all(
      libraryId,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern
    ) as BookRow[];

  return rows.map((row) => toBookSummary(database, row, userId));
};

/**
 * Finds a book only when it belongs to the requested library.
 */
export const findBookDetail = (
  database: BookCafeDatabase,
  libraryId: string,
  bookId: string,
  userId?: string
): BookDetail | null => {
  const row = database.sqlite
    .prepare("SELECT * FROM books WHERE library_id = ? AND id = ?")
    .get(libraryId, bookId) as BookRow | undefined;

  return row ? toBookDetail(database, row, userId) : null;
};

/**
 * Lists the persisted page snapshot for a scoped book.
 */
export const listBookPages = (
  database: BookCafeDatabase,
  libraryId: string,
  bookId: string
): BookPageRecord[] => {
  if (!findBookDetail(database, libraryId, bookId)) {
    return [];
  }

  return (
    database.sqlite
      .prepare(
        "SELECT * FROM book_pages WHERE book_id = ? ORDER BY page_number"
      )
      .all(bookId) as BookPageRow[]
  ).map(toBookPageRecord);
};

/**
 * Finds one page only when its book belongs to the requested library.
 */
export const findBookPage = (
  database: BookCafeDatabase,
  libraryId: string,
  bookId: string,
  pageNumber: number
): BookPageRecord | null => {
  if (!findBookDetail(database, libraryId, bookId)) {
    return null;
  }

  const row = database.sqlite
    .prepare("SELECT * FROM book_pages WHERE book_id = ? AND page_number = ?")
    .get(bookId, pageNumber) as BookPageRow | undefined;

  return row ? toBookPageRecord(row) : null;
};

/**
 * Stores central thumbnail metadata for a scoped book.
 */
export const setBookThumbnail = (
  database: BookCafeDatabase,
  input: SetBookThumbnailInput
): BookDetail | null => {
  if (!findBookDetail(database, input.libraryId, input.bookId)) {
    return null;
  }

  const now = Date.now();

  database.sqlite
    .prepare(
      `INSERT INTO thumbnails (
        id,
        library_id,
        book_id,
        path,
        page,
        width,
        height,
        generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (book_id) DO UPDATE SET
        library_id = excluded.library_id,
        path = excluded.path,
        page = excluded.page,
        width = excluded.width,
        height = excluded.height,
        generated_at = excluded.generated_at`
    )
    .run(
      `${input.bookId}:${input.page}`,
      input.libraryId,
      input.bookId,
      resolve(input.path),
      input.page,
      input.width,
      input.height,
      now
    );

  return findBookDetail(database, input.libraryId, input.bookId);
};

/**
 * Finds central thumbnail metadata for a scoped book.
 */
export const findBookThumbnail = (
  database: BookCafeDatabase,
  libraryId: string,
  bookId: string
): ThumbnailRecord | null => {
  const row = database.sqlite
    .prepare("SELECT * FROM thumbnails WHERE library_id = ? AND book_id = ?")
    .get(libraryId, bookId) as ThumbnailRow | undefined;

  return row
    ? {
        id: row.id,
        libraryId: row.library_id,
        bookId: row.book_id,
        path: row.path,
        page: row.page,
        width: row.width,
        height: row.height,
        generatedAt: new Date(row.generated_at)
      }
    : null;
};

/**
 * Updates user-editable metadata without changing the source locator.
 */
export const updateBookMetadata = (
  database: BookCafeDatabase,
  libraryId: string,
  bookId: string,
  input: UpdateBookMetadataInput
): BookDetail | null => {
  if (!findBookDetail(database, libraryId, bookId)) {
    return null;
  }

  const now = Date.now();

  database.sqlite
    .prepare(
      `UPDATE books
       SET title = ?,
           authors_json = ?,
           publisher = ?,
           isbn = ?,
           purchased_at = ?,
           reading_status = ?,
           tags_json = ?,
           notes = ?,
           metadata_edited_at = ?,
           updated_at = ?
       WHERE library_id = ? AND id = ?`
    )
    .run(
      normalizeRequiredText(input.title),
      JSON.stringify(normalizeTextArray(input.authors)),
      normalizeNullableText(input.publisher),
      normalizeNullableText(input.isbn),
      normalizeNullableText(input.purchasedAt),
      input.readingStatus,
      JSON.stringify(normalizeTextArray(input.tags)),
      normalizeNullableText(input.notes),
      now,
      now,
      libraryId,
      bookId
    );

  return findBookDetail(database, libraryId, bookId);
};

/**
 * Stores one user's one-based reading position for a scoped book.
 */
export const updateReadingProgress = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  bookId: string,
  currentPage: number
): BookDetail | null => {
  const book = findBookDetail(database, libraryId, bookId, userId);

  if (!book) {
    return null;
  }

  const clampedPage = Math.min(
    Math.max(Math.trunc(currentPage), 1),
    book.pageCount
  );

  database.sqlite
    .prepare(
      `INSERT INTO reading_progress (
        user_id,
        book_id,
        current_page,
        updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, book_id) DO UPDATE SET
        current_page = excluded.current_page,
        updated_at = excluded.updated_at`
    )
    .run(userId, bookId, clampedPage, Date.now());

  return findBookDetail(database, libraryId, bookId, userId);
};

/**
 * Hides a book from normal lists without deleting its metadata or pages.
 */
export const archiveBook = (
  database: BookCafeDatabase,
  libraryId: string,
  bookId: string
): BookDetail | null => {
  const result = database.sqlite
    .prepare(
      `UPDATE books
       SET archived_at = COALESCE(archived_at, ?), updated_at = ?
       WHERE library_id = ? AND id = ?`
    )
    .run(Date.now(), Date.now(), libraryId, bookId);

  return Number(result.changes) > 0
    ? findBookDetail(database, libraryId, bookId)
    : null;
};

/**
 * Restores an archived book to normal lists.
 */
export const restoreBook = (
  database: BookCafeDatabase,
  libraryId: string,
  bookId: string
): BookDetail | null => {
  const result = database.sqlite
    .prepare(
      `UPDATE books
       SET archived_at = NULL, updated_at = ?
       WHERE library_id = ? AND id = ?`
    )
    .run(Date.now(), libraryId, bookId);

  return Number(result.changes) > 0
    ? findBookDetail(database, libraryId, bookId)
    : null;
};

/**
 * Creates a queued library-scoped job.
 */
export const createJob = (
  database: BookCafeDatabase,
  input: CreateJobInput
): JobRecord => {
  const now = Date.now();
  const id = randomUUID();

  database.sqlite
    .prepare(
      `INSERT INTO jobs (
        id,
        library_id,
        type,
        status,
        payload,
        progress,
        error,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'queued', ?, 0, NULL, ?, ?)`
    )
    .run(
      id,
      input.libraryId,
      input.type,
      JSON.stringify(input.payload),
      now,
      now
    );

  return findJobById(database, id) as JobRecord;
};

/**
 * Lists jobs for one library in newest-first order.
 */
export const listJobs = (
  database: BookCafeDatabase,
  libraryId: string
): JobRecord[] =>
  (
    database.sqlite
      .prepare(
        `SELECT *
         FROM jobs
         WHERE library_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(libraryId) as JobRow[]
  ).map(toJobRecord);

/**
 * Finds a job only within the requested library.
 */
export const findJob = (
  database: BookCafeDatabase,
  libraryId: string,
  jobId: string
): JobRecord | null => {
  const row = database.sqlite
    .prepare("SELECT * FROM jobs WHERE library_id = ? AND id = ?")
    .get(libraryId, jobId) as JobRow | undefined;

  return row ? toJobRecord(row) : null;
};

/**
 * Persists one path-safe scan failure, updating its classification on duplicates.
 */
export const createScanFailure = (
  database: BookCafeDatabase,
  input: CreateScanFailureInput
): ScanFailureRecord => {
  const relativePath = normalizeRelativePath(input.relativePath, true);
  const id = randomUUID();

  database.sqlite
    .prepare(
      `INSERT INTO scan_failures (
        id,
        job_id,
        kind,
        relative_path,
        format,
        code,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (job_id, kind, relative_path) DO UPDATE SET
        format = excluded.format,
        code = excluded.code`
    )
    .run(
      id,
      input.jobId,
      input.kind,
      relativePath,
      input.format,
      input.code,
      Date.now()
    );

  const row = database.sqlite
    .prepare(
      `SELECT *
       FROM scan_failures
       WHERE job_id = ? AND kind = ? AND relative_path = ?`
    )
    .get(input.jobId, input.kind, relativePath) as ScanFailureRow;

  return toScanFailureRecord(row);
};

/**
 * Lists one bounded page of failures for a library-scoped scan job.
 */
export const listScanFailures = (
  database: BookCafeDatabase,
  libraryId: string,
  jobId: string,
  options: ListScanFailuresOptions = {}
): ScanFailurePage | null => {
  if (!findJob(database, libraryId, jobId)) {
    return null;
  }

  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 100)), 100);
  const totalRow = database.sqlite
    .prepare(
      `SELECT COUNT(*) AS value
       FROM scan_failures
       WHERE job_id = ?`
    )
    .get(jobId) as { value: number };
  const total = Number(totalRow.value);
  const failures = (
    database.sqlite
      .prepare(
        `SELECT *
         FROM scan_failures
         WHERE job_id = ?
         ORDER BY relative_path COLLATE NOCASE ASC, kind ASC, id ASC
         LIMIT ? OFFSET ?`
      )
      .all(jobId, limit, offset) as ScanFailureRow[]
  ).map(toScanFailureRecord);

  return {
    failures,
    total,
    offset,
    limit,
    hasMore: offset + failures.length < total
  };
};

/**
 * Returns whether a library has a queued or running job.
 */
export const hasActiveLibraryJobs = (
  database: BookCafeDatabase,
  libraryId: string
): boolean =>
  Boolean(
    database.sqlite
      .prepare(
        `SELECT 1
         FROM jobs
         WHERE library_id = ? AND status IN ('queued', 'running')
         LIMIT 1`
      )
      .get(libraryId)
  );

/**
 * Cancels a queued or running job within one library.
 */
export const cancelJob = (
  database: BookCafeDatabase,
  libraryId: string,
  jobId: string
): CancelJobResult => {
  const result = database.sqlite
    .prepare(
      `UPDATE jobs
       SET status = 'cancelled', error = NULL, updated_at = ?
       WHERE library_id = ?
         AND id = ?
         AND status IN ('queued', 'running')`
    )
    .run(Date.now(), libraryId, jobId);

  if (Number(result.changes) > 0) {
    return "cancelled";
  }

  return findJob(database, libraryId, jobId) ? "not-cancellable" : "not-found";
};

/**
 * Marks a queued job as running.
 */
export const markJobRunning = (
  database: BookCafeDatabase,
  jobId: string
): JobRecord | null =>
  updateJobStatus(database, jobId, "running", 5, null, ["queued"]);

/**
 * Marks a running job as completed.
 */
export const markJobCompleted = (
  database: BookCafeDatabase,
  jobId: string
): JobRecord | null =>
  updateJobStatus(database, jobId, "completed", 100, null, ["running"]);

/**
 * Marks a queued or running job as failed.
 */
export const markJobFailed = (
  database: BookCafeDatabase,
  jobId: string,
  error: string
): JobRecord | null =>
  updateJobStatus(database, jobId, "failed", 100, error, ["queued", "running"]);

/**
 * Updates a running job progress value.
 */
export const updateJobProgress = (
  database: BookCafeDatabase,
  jobId: string,
  progress: number
): JobRecord | null => {
  database.sqlite
    .prepare(
      `UPDATE jobs
       SET progress = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(Math.min(Math.max(Math.trunc(progress), 0), 100), Date.now(), jobId);

  return findJobById(database, jobId);
};

/**
 * Replaces a running or queued job payload.
 */
export const updateJobPayload = (
  database: BookCafeDatabase,
  jobId: string,
  payload: unknown
): JobRecord | null => {
  database.sqlite
    .prepare(
      `UPDATE jobs
       SET payload = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`
    )
    .run(JSON.stringify(payload), Date.now(), jobId);

  return findJobById(database, jobId);
};

/**
 * Marks jobs left active by a stopped server as failed.
 */
export const markInterruptedJobsFailed = (
  database: BookCafeDatabase
): number => {
  const result = database.sqlite
    .prepare(
      `UPDATE jobs
       SET status = 'failed',
           progress = 100,
           error = 'Job interrupted by server shutdown.',
           updated_at = ?
       WHERE status IN ('queued', 'running')`
    )
    .run(Date.now());

  return Number(result.changes);
};

/**
 * Returns the user's selected library id.
 */
export const getLibraryPreference = (
  database: BookCafeDatabase,
  userId: string
): string | null => {
  const row = database.sqlite
    .prepare(
      "SELECT selected_library_id FROM user_preferences WHERE user_id = ?"
    )
    .get(userId) as { selected_library_id: string | null } | undefined;

  return row?.selected_library_id ?? null;
};

/**
 * Stores or clears the user's selected library id.
 */
export const setLibraryPreference = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string | null
): string | null => {
  database.sqlite
    .prepare(
      `INSERT INTO user_preferences (
        user_id,
        selected_library_id,
        updated_at
      ) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        selected_library_id = excluded.selected_library_id,
        updated_at = excluded.updated_at`
    )
    .run(userId, libraryId, Date.now());

  return getLibraryPreference(database, userId);
};

/**
 * Tests whether a SQLite table exists.
 */
const tableExists = (database: BookCafeDatabase, tableName: string): boolean =>
  Boolean(
    database.sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );

/**
 * Adds one nullable column when opening a database created by an older build.
 */
const addColumnIfMissing = (
  database: BookCafeDatabase,
  tableName: string,
  columnName: string,
  definition: string
): void => {
  const columns = database.sqlite.pragma(`table_info(${tableName})`) as Array<{
    name: string;
  }>;

  if (!columns.some((column) => column.name === columnName)) {
    database.sqlite.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
    );
  }
};

/**
 * Creates a typed domain error without a class hierarchy.
 */
const createDomainError = (
  code: BookCafeDomainError["code"],
  message: string
): BookCafeDomainError =>
  Object.assign(new Error(message), {
    code
  }) as BookCafeDomainError;

/**
 * Rejects a duplicate case-insensitive library name.
 */
const assertLibraryNameAvailable = (
  database: BookCafeDatabase,
  name: string,
  ignoredLibraryId?: string
): void => {
  const row = database.sqlite
    .prepare(
      `SELECT id
       FROM libraries
       WHERE name = ? COLLATE NOCASE
         AND (? IS NULL OR id <> ?)
       LIMIT 1`
    )
    .get(name, ignoredLibraryId ?? null, ignoredLibraryId ?? null);

  if (row) {
    throw createDomainError(
      "LIBRARY_NAME_CONFLICT",
      "A library with the same name already exists."
    );
  }
};

/**
 * Rejects duplicate collection names inside one user's selected library.
 */
const assertCollectionNameAvailable = (
  database: BookCafeDatabase,
  userId: string,
  libraryId: string,
  name: string,
  ignoredCollectionId?: string
): void => {
  const row = database.sqlite
    .prepare(
      `SELECT id
       FROM collections
       WHERE user_id = ?
         AND library_id = ?
         AND name = ? COLLATE NOCASE
         AND (? IS NULL OR id <> ?)
       LIMIT 1`
    )
    .get(
      userId,
      libraryId,
      name,
      ignoredCollectionId ?? null,
      ignoredCollectionId ?? null
    );

  if (row) {
    throw createDomainError(
      "COLLECTION_NAME_CONFLICT",
      "A collection with the same name already exists."
    );
  }
};

/**
 * Rewrites one collection's positions to a contiguous zero-based sequence.
 */
const compactCollectionBookPositions = (
  database: BookCafeDatabase,
  collectionId: string
): void => {
  const rows = database.sqlite
    .prepare(
      `SELECT book_id
       FROM collection_books
       WHERE collection_id = ?
       ORDER BY position, added_at, book_id`
    )
    .all(collectionId) as Array<{ book_id: string }>;
  const updatePosition = database.sqlite.prepare(
    `UPDATE collection_books
     SET position = ?
     WHERE collection_id = ? AND book_id = ?`
  );

  rows.forEach(({ book_id }, position) =>
    updatePosition.run(position, collectionId, book_id)
  );
};

/**
 * Rejects duplicate, parent, and child canonical roots.
 */
const assertLibraryPathAvailable = (
  database: BookCafeDatabase,
  canonicalRootPath: string,
  ignoredLibraryId?: string
): void => {
  const rows = database.sqlite
    .prepare(
      `SELECT id, canonical_root_path
       FROM libraries
       WHERE (? IS NULL OR id <> ?)`
    )
    .all(ignoredLibraryId ?? null, ignoredLibraryId ?? null) as Array<{
    id: string;
    canonical_root_path: string;
  }>;

  if (
    rows.some((row) =>
      pathsOverlap(resolve(row.canonical_root_path), canonicalRootPath)
    )
  ) {
    throw createDomainError(
      "LIBRARY_PATH_CONFLICT",
      "Library roots cannot be equal, parents, or children of one another."
    );
  }
};

/**
 * Returns whether either normalized path contains the other.
 */
const pathsOverlap = (firstPath: string, secondPath: string): boolean =>
  isPathInside(firstPath, secondPath) || isPathInside(secondPath, firstPath);

/**
 * Returns whether a candidate is equal to or inside a root.
 */
const isPathInside = (rootPath: string, candidatePath: string): boolean => {
  const pathFromRoot = relative(rootPath, candidatePath);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
};

/**
 * Trims a required user-facing text field.
 */
const normalizeRequiredText = (value: string): string => {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("A required text field was empty.");
  }

  return normalized;
};

/**
 * Trims, deduplicates, and removes empty string-list values.
 */
const normalizeTextArray = (values: readonly string[]): string[] => {
  const normalizedValues = values.map((value) => value.trim()).filter(Boolean);

  return Array.from(new Set(normalizedValues));
};

/**
 * Trims nullable text and converts empty strings to null.
 */
const normalizeNullableText = (value: string | null): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized || null;
};

/**
 * Normalizes a library-relative locator and rejects path traversal.
 */
const normalizeRelativePath = (
  value: string,
  allowLibraryRoot = false
): string => {
  const trimmed = value.trim();

  if (allowLibraryRoot && trimmed === ".") {
    return ".";
  }

  if (
    !trimmed ||
    isAbsolute(trimmed) ||
    /^[A-Za-z]:[\\/]/u.test(trimmed) ||
    trimmed.startsWith("\\\\")
  ) {
    throw createDomainError(
      "INVALID_RELATIVE_PATH",
      "Source locators must be relative to their library."
    );
  }

  const normalized = trimmed
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");

  if (
    !normalized ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw createDomainError(
      "INVALID_RELATIVE_PATH",
      "Source locators cannot traverse outside their library."
    );
  }

  return normalized;
};

/**
 * Normalizes and validates a format-specific page locator.
 */
const normalizeBookPageInput = (
  page: BookPageInput
): Required<Omit<BookPageInput, "relativePath" | "entryPath" | "mimeType">> & {
  relativePath: string | null;
  entryPath: string | null;
  mimeType: string | null;
} => {
  const relativePath =
    page.relativePath === null || page.relativePath === undefined
      ? null
      : normalizeRelativePath(page.relativePath);
  const entryPath =
    page.entryPath === null || page.entryPath === undefined
      ? null
      : normalizeRelativePath(page.entryPath);
  const sourcePageNumber = page.sourcePageNumber ?? null;

  if (
    (page.sourceType === "file" &&
      (!relativePath || entryPath || sourcePageNumber)) ||
    ((page.sourceType === "archive-entry" ||
      page.sourceType === "packed-archive-entry") &&
      (!relativePath || !entryPath || sourcePageNumber)) ||
    ((page.sourceType === "pdf-page" || page.sourceType === "epub-page") &&
      (!relativePath || entryPath || !sourcePageNumber))
  ) {
    throw createDomainError(
      "INVALID_RELATIVE_PATH",
      "The page locator does not match its source type."
    );
  }

  return {
    pageNumber: Math.max(1, Math.trunc(page.pageNumber)),
    sourceType: page.sourceType,
    relativePath,
    entryPath,
    sourcePageNumber,
    width: page.width ?? null,
    height: page.height ?? null,
    mimeType: page.mimeType ?? null
  };
};

/**
 * Finds a book row by its stable library-relative locator.
 */
const findBookRowByRelativePath = (
  database: BookCafeDatabase,
  libraryId: string,
  relativePath: string
): BookRow | null =>
  (database.sqlite
    .prepare("SELECT * FROM books WHERE library_id = ? AND relative_path = ?")
    .get(libraryId, relativePath) as BookRow | undefined) ?? null;

/**
 * Lists either visible or archived book rows for one library.
 */
const listBookRows = (
  database: BookCafeDatabase,
  libraryId: string,
  archived: boolean
): BookRow[] =>
  database.sqlite
    .prepare(
      `SELECT *
       FROM books
       WHERE library_id = ?
         AND archived_at IS ${archived ? "NOT NULL" : "NULL"}
       ORDER BY title COLLATE NOCASE, relative_path`
    )
    .all(libraryId) as BookRow[];

/**
 * Maps validated sort options to a stable SQL ordering for offset pagination.
 */
const getBookOrderClause = (sort: BookSort, order: SortOrder): string => {
  const direction = order === "desc" ? "DESC" : "ASC";

  switch (sort) {
    case "purchasedAt":
      return `books.purchased_at IS NULL,
        books.purchased_at ${direction},
        books.title COLLATE NOCASE ASC,
        books.id ASC`;
    case "updatedAt":
      return `books.updated_at ${direction}, books.id ${direction}`;
    case "lastReadAt":
      return `progress.updated_at IS NULL,
        progress.updated_at ${direction},
        books.title COLLATE NOCASE ASC,
        books.id ASC`;
    default:
      return `books.title COLLATE NOCASE ${direction},
        books.relative_path COLLATE NOCASE ${direction},
        books.id ${direction}`;
  }
};

/**
 * Reads one user's saved position or defaults to page one.
 */
const getCurrentPage = (
  database: BookCafeDatabase,
  bookId: string,
  userId?: string
): number => {
  if (!userId) {
    return 1;
  }

  const row = database.sqlite
    .prepare(
      "SELECT current_page FROM reading_progress WHERE user_id = ? AND book_id = ?"
    )
    .get(userId, bookId) as { current_page: number } | undefined;

  return row?.current_page ?? 1;
};

/**
 * Converts a library row into the domain record.
 */
const toLibraryRecord = (row: LibraryRow): LibraryRecord => ({
  id: row.id,
  name: row.name,
  rootPath: row.root_path,
  canonicalRootPath: row.canonical_root_path,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at)
});

/**
 * Converts an aggregate collection row into the domain record.
 */
const toCollectionRecord = (row: CollectionRow): CollectionRecord => ({
  id: row.id,
  libraryId: row.library_id,
  name: row.name,
  bookCount: row.book_count,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at)
});

/**
 * Converts a book row into an API summary without absolute paths.
 */
const toBookSummary = (
  database: BookCafeDatabase,
  row: BookRow,
  userId?: string
): BookSummary => ({
  id: row.id,
  libraryId: row.library_id,
  relativePath: row.relative_path,
  title: row.title,
  authors: parseStringArray(row.authors_json),
  format: row.format as BookFormat,
  status: row.status as BookStatus,
  readingStatus: row.reading_status as ReadingStatus,
  tags: parseStringArray(row.tags_json),
  pageCount: row.page_count,
  currentPage: getCurrentPage(database, row.id, userId),
  thumbnailUrl: findBookThumbnail(database, row.library_id, row.id)
    ? `/api/libraries/${encodeURIComponent(row.library_id)}/books/${encodeURIComponent(row.id)}/thumbnail`
    : null,
  archivedAt:
    row.archived_at === null ? null : new Date(row.archived_at).toISOString()
});

/**
 * Converts a book row into an API detail without absolute paths.
 */
const toBookDetail = (
  database: BookCafeDatabase,
  row: BookRow,
  userId?: string
): BookDetail => ({
  ...toBookSummary(database, row, userId),
  readingDirection: row.reading_direction as ReadingDirection,
  publisher: row.publisher,
  isbn: row.isbn,
  purchasedAt: row.purchased_at,
  notes: row.notes
});

/**
 * Converts a page row into its format-specific relative locator.
 */
const toBookPageRecord = (row: BookPageRow): BookPageRecord => ({
  bookId: row.book_id,
  pageNumber: row.page_number,
  sourceType: row.source_type as BookPageSourceType,
  relativePath: row.relative_path,
  entryPath: row.entry_path,
  sourcePageNumber: row.source_page_number,
  width: row.width,
  height: row.height,
  mimeType: row.mime_type,
  createdAt: new Date(row.created_at)
});

/**
 * Parses a stored JSON string array defensively.
 */
const parseStringArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

/**
 * Finds a job by id for internal state transitions.
 */
const findJobById = (
  database: BookCafeDatabase,
  jobId: string
): JobRecord | null => {
  const row = database.sqlite
    .prepare("SELECT * FROM jobs WHERE id = ?")
    .get(jobId) as JobRow | undefined;

  return row ? toJobRecord(row) : null;
};

/**
 * Converts a job row into a domain record.
 */
const toJobRecord = (row: JobRow): JobRecord => ({
  id: row.id,
  libraryId: row.library_id,
  type: row.type as JobType,
  status: row.status as JobStatus,
  payload: parseJsonValue(row.payload),
  progress: row.progress,
  error: row.error,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at)
});

/**
 * Converts one persisted scan failure to its domain representation.
 */
const toScanFailureRecord = (row: ScanFailureRow): ScanFailureRecord => ({
  id: row.id,
  jobId: row.job_id,
  kind: row.kind as ScanFailureKind,
  relativePath: row.relative_path,
  format: row.format as BookFormat,
  code: row.code as ScanFailureCode,
  createdAt: new Date(row.created_at)
});

/**
 * Parses a stored JSON value while preserving invalid data as null.
 */
const parseJsonValue = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/**
 * Applies one guarded job status transition.
 */
const updateJobStatus = (
  database: BookCafeDatabase,
  jobId: string,
  status: JobStatus,
  progress: number,
  error: string | null,
  allowedStatuses: readonly JobStatus[]
): JobRecord | null => {
  const placeholders = allowedStatuses.map(() => "?").join(", ");

  database.sqlite
    .prepare(
      `UPDATE jobs
       SET status = ?, progress = ?, error = ?, updated_at = ?
       WHERE id = ? AND status IN (${placeholders})`
    )
    .run(status, progress, error, Date.now(), jobId, ...allowedStatuses);

  return findJobById(database, jobId);
};
