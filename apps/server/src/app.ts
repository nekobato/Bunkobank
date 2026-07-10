/**
 * Hono app factory for BookCafe.
 */

import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadConfig,
  resolveDataPaths,
  saveConfig,
  type AppConfig
} from "@bookcafe/config";
import {
  backgroundJobListResponseSchema,
  backgroundJobCreateManyResponseSchema,
  backgroundJobSchema,
  bookDetailSchema,
  bookListQuerySchema,
  bookListResponseSchema,
  collectionRootCreateRequestSchema,
  collectionRootListResponseSchema,
  collectionRootSchema,
  healthResponseSchema,
  initialSetupRequestSchema,
  libraryExportResponseSchema,
  networkSettingsSchema,
  scanJobCreateRequestSchema,
  setupStatusSchema,
  thumbnailSettingsSchema,
  updateBookMetadataRequestSchema,
  updateNetworkSettingsRequestSchema,
  updateThumbnailSettingsRequestSchema,
  updateBookProgressRequestSchema
} from "@bookcafe/contracts";
import {
  closeDatabase,
  createJob,
  deleteCollectionRoot,
  findBookDetail,
  findBookPage,
  findBookThumbnail,
  findCollectionRoot,
  findJob,
  listBookDetails,
  listBookSummaries,
  listCollectionRoots,
  listJobs,
  markInterruptedJobsFailed,
  openBookCafeDatabase,
  searchBookSummaries,
  updateBookMetadata,
  updateBookCurrentPage,
  upsertCollectionRoot,
  type BookCafeDatabase,
  type CollectionRootRow,
  type JobRecord
} from "@bookcafe/db";
import {
  readArchiveImageEntry,
  readPackedArchiveImageEntry,
  renderEpubPageImage,
  renderPdfPageImage
} from "@bookcafe/format-adapters";
import { zValidator } from "@hono/zod-validator";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { Hono } from "hono";

import { getAuth, runAuthMigrations } from "./auth.js";
import {
  findSampleBook,
  listSampleBooks,
  renderSamplePageSvg
} from "./sample-books.js";
import { createBookCafeJobQueue, type BookCafeJobQueue } from "./job-queue.js";
import { runScanCollectionRootJob } from "./scan-jobs.js";

import type { BookDetail, BookSummary, ReadingStatus } from "@bookcafe/core";

type Auth = ReturnType<typeof getAuth>;

interface AppVariables {
  user: Auth["$Infer"]["Session"]["user"] | null;
  session: Auth["$Infer"]["Session"]["session"] | null;
}

interface AppOptions {
  configPath?: string;
  jobQueue?: BookCafeJobQueue;
  publicDir?: string;
}

/**
 * Creates the Hono application.
 */
export const createApp = (options: AppOptions = {}) => {
  const app = new Hono<{ Variables: AppVariables }>();
  const jobQueue = options.jobQueue ?? createBookCafeJobQueue();
  const publicDir = options.publicDir ?? getDefaultPublicDir();

  const readConfig = (): AppConfig => loadConfig(options.configPath);
  const writeConfig = (config: AppConfig): AppConfig =>
    saveConfig(config, options.configPath);
  const readAuth = (): Auth => getAuth(readConfig());

  /**
   * Opens the configured SQLite database for a short operation.
   */
  const withDatabase = async <T>(
    callback: (database: BookCafeDatabase) => T | Promise<T>
  ): Promise<T> => {
    const paths = resolveDataPaths(readConfig().dataDir);
    const database = openBookCafeDatabase(paths.databasePath);

    try {
      return await callback(database);
    } finally {
      closeDatabase(database);
    }
  };

  /**
   * Converts jobs owned by a previous server process into terminal failures.
   */
  const failInterruptedJobs = (): void => {
    const config = readConfig();

    if (!config.setupComplete) {
      return;
    }

    const paths = resolveDataPaths(config.dataDir);
    const database = openBookCafeDatabase(paths.databasePath);

    try {
      markInterruptedJobsFailed(database);
    } finally {
      closeDatabase(database);
    }
  };

  failInterruptedJobs();

  app.use(
    "/api/*",
    cors({
      origin: ["http://127.0.0.1:3000", "http://localhost:3000"],
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      credentials: true
    })
  );

  app.use("*", async (c, next) => {
    if (!c.req.path.startsWith("/api/")) {
      await next();
      return;
    }

    if (isPublicApiRoute(c.req.path, c.req.method)) {
      await next();
      return;
    }

    if (!readConfig().setupComplete) {
      return c.json({ message: "Setup is required." }, 409);
    }

    const auth = readAuth();
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", session?.user ?? null);
    c.set("session", session?.session ?? null);

    if (!session?.user || !session.session) {
      return c.json({ message: "Authentication required." }, 401);
    }

    await next();
  });

  app.on(["GET", "POST"], "/api/auth/get-session", (c) => {
    if (!readConfig().setupComplete) {
      return c.json(null);
    }

    return readAuth().handler(c.req.raw);
  });

  app.on(["GET", "POST"], "/api/auth/*", (c) => readAuth().handler(c.req.raw));

  app.get("/api/health", (c) =>
    c.json(
      healthResponseSchema.parse({
        ok: true,
        service: "bookcafe-server"
      })
    )
  );

  app.get("/api/setup/status", (c) =>
    c.json(
      setupStatusSchema.parse({
        setupComplete: readConfig().setupComplete,
        host: readConfig().host,
        port: readConfig().port,
        thumbnails: readConfig().thumbnails
      })
    )
  );

  app.post(
    "/api/setup/initial-user",
    zValidator("json", initialSetupRequestSchema),
    async (c) => {
      const current = readConfig();

      if (current.setupComplete) {
        return c.json({ message: "Setup is already complete." }, 409);
      }

      const body = c.req.valid("json");
      const dataDir = body.dataDir ?? current.dataDir;
      const nextConfig = writeConfig({
        ...current,
        dataDir,
        host: body.host,
        port: body.port,
        thumbnails: body.thumbnails,
        setupComplete: false
      });
      const auth = getAuth(nextConfig);
      const database = openBookCafeDatabase(
        resolveDataPaths(nextConfig.dataDir).databasePath
      );

      closeDatabase(database);

      await runAuthMigrations(auth);
      await auth.api.signUpEmail({
        body: {
          email: `${body.username}@bookcafe.local`,
          name: body.username,
          username: body.username,
          password: body.password
        },
        headers: c.req.raw.headers
      });

      writeConfig({
        ...nextConfig,
        setupComplete: true
      });

      return c.json(
        setupStatusSchema.parse({
          setupComplete: true,
          host: nextConfig.host,
          port: nextConfig.port,
          thumbnails: nextConfig.thumbnails
        }),
        201
      );
    }
  );

  app.get("/api/settings/network", (c) => {
    const config = readConfig();

    return c.json(
      networkSettingsSchema.parse({
        host: config.host,
        port: config.port,
        restartRequired: false
      })
    );
  });

  app.patch(
    "/api/settings/network",
    zValidator("json", updateNetworkSettingsRequestSchema),
    (c) => {
      const current = readConfig();
      const body = c.req.valid("json");
      const restartRequired =
        current.host !== body.host || current.port !== body.port;
      const nextConfig = writeConfig({
        ...current,
        host: body.host,
        port: body.port
      });

      return c.json(
        networkSettingsSchema.parse({
          host: nextConfig.host,
          port: nextConfig.port,
          restartRequired
        })
      );
    }
  );

  app.get("/api/settings/thumbnails", (c) => {
    const config = readConfig();

    return c.json(thumbnailSettingsSchema.parse(config.thumbnails));
  });

  app.patch(
    "/api/settings/thumbnails",
    zValidator("json", updateThumbnailSettingsRequestSchema),
    (c) => {
      const current = readConfig();
      const body = c.req.valid("json");
      const nextConfig = writeConfig({
        ...current,
        thumbnails: body
      });

      return c.json(thumbnailSettingsSchema.parse(nextConfig.thumbnails));
    }
  );

  app.get("/api/collection-roots", async (c) => {
    const roots = await withDatabase((database) =>
      listCollectionRoots(database).map(toCollectionRootResponse)
    );

    return c.json(collectionRootListResponseSchema.parse({ roots }));
  });

  app.post(
    "/api/collection-roots",
    zValidator("json", collectionRootCreateRequestSchema),
    async (c) => {
      const body = c.req.valid("json");

      if (!(await isReadableDirectory(body.path))) {
        return c.json(
          { message: "Collection root must be a readable directory." },
          400
        );
      }

      const root = await withDatabase((database) =>
        upsertCollectionRoot(database, body.path)
      );

      return c.json(
        collectionRootSchema.parse(toCollectionRootResponse(root)),
        201
      );
    }
  );

  app.delete("/api/collection-roots/:rootId", async (c) => {
    const result = await withDatabase((database) =>
      deleteCollectionRoot(database, c.req.param("rootId"))
    );

    if (result === "not-found") {
      return c.json({ message: "Collection root not found." }, 404);
    }

    if (result === "has-books") {
      return c.json(
        { message: "Collection root contains scanned books." },
        409
      );
    }

    return c.body(null, 204);
  });

  app.get("/api/jobs", async (c) => {
    const jobs = await withDatabase((database) =>
      listJobs(database).map(toBackgroundJobResponse)
    );

    return c.json(backgroundJobListResponseSchema.parse({ jobs }));
  });

  app.get("/api/jobs/:jobId", async (c) => {
    const job = await withDatabase((database) =>
      findJob(database, c.req.param("jobId"))
    );

    if (!job) {
      return c.json({ message: "Job not found." }, 404);
    }

    return c.json(backgroundJobSchema.parse(toBackgroundJobResponse(job)));
  });

  app.post(
    "/api/jobs/scan",
    zValidator("json", scanJobCreateRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      const root = await withDatabase((database) =>
        findCollectionRoot(database, body.collectionRootId)
      );

      if (!root) {
        return c.json({ message: "Collection root not found." }, 404);
      }

      const job = await withDatabase((database) =>
        createJob(database, {
          type: "scan-collection-root",
          payload: {
            collectionRootId: root.id,
            path: root.path
          }
        })
      );

      jobQueue.add(() =>
        runScanCollectionRootJob({
          configPath: options.configPath,
          jobId: job.id,
          collectionRootId: root.id
        })
      );

      return c.json(
        backgroundJobSchema.parse(toBackgroundJobResponse(job)),
        202
      );
    }
  );

  app.post("/api/jobs/scan-all", async (c) => {
    const jobs = await withDatabase((database) =>
      listCollectionRoots(database).map((root) =>
        createJob(database, {
          type: "scan-collection-root",
          payload: {
            collectionRootId: root.id,
            path: root.path
          }
        })
      )
    );

    for (const job of jobs) {
      const payload = job.payload as {
        collectionRootId?: unknown;
      };
      const collectionRootId = String(payload.collectionRootId ?? "");

      if (!collectionRootId) {
        continue;
      }

      jobQueue.add(() =>
        runScanCollectionRootJob({
          configPath: options.configPath,
          jobId: job.id,
          collectionRootId
        })
      );
    }

    return c.json(
      backgroundJobCreateManyResponseSchema.parse({
        jobs: jobs.map(toBackgroundJobResponse)
      }),
      202
    );
  });

  app.get("/api/library/export", async (c) => {
    const exportedAt = new Date();
    const { collectionRoots, books } = await withDatabase((database) => ({
      collectionRoots: listCollectionRoots(database).map(
        toCollectionRootResponse
      ),
      books: listBookDetails(database)
    }));

    c.header(
      "Content-Disposition",
      `attachment; filename="${createLibraryExportFileName(exportedAt)}"`
    );
    c.header("Cache-Control", "no-store");

    return c.json(
      libraryExportResponseSchema.parse({
        schemaVersion: 1,
        exportedAt: exportedAt.toISOString(),
        collectionRoots,
        books
      })
    );
  });

  app.get("/api/books", zValidator("query", bookListQuerySchema), async (c) => {
    const requestQuery = c.req.valid("query");
    const query = requestQuery.q ?? "";
    const readingStatus = requestQuery.readingStatus ?? null;
    const bookStatus = requestQuery.bookStatus ?? null;
    const { allBooks, matchingBooks } = await withDatabase((database) => {
      const books = listBookSummaries(database);

      return {
        allBooks: books,
        matchingBooks:
          query.length > 0 ? searchBookSummaries(database, query) : books
      };
    });
    const response = {
      books: selectBookListResponseBooks({
        allBooks,
        matchingBooks,
        query,
        readingStatus,
        bookStatus,
        sampleBooks: listSampleBooks()
      })
    };

    return c.json(bookListResponseSchema.parse(response));
  });

  app.get("/api/books/:bookId", async (c) => {
    const book = await findBook(c.req.param("bookId"), withDatabase);

    if (!book) {
      return c.json({ message: "Book not found." }, 404);
    }

    return c.json(bookDetailSchema.parse(book));
  });

  app.get("/api/books/:bookId/thumbnail", async (c) => {
    const thumbnail = await withDatabase((database) =>
      findBookThumbnail(database, c.req.param("bookId"))
    );

    if (!thumbnail) {
      return c.json({ message: "Thumbnail not found." }, 404);
    }

    try {
      const image = await readFile(thumbnail.path);

      return c.body(new Uint8Array(image), 200, {
        "Content-Type": "image/webp",
        "Cache-Control": "no-store"
      });
    } catch {
      return c.json({ message: "Thumbnail is not readable." }, 404);
    }
  });

  app.patch(
    "/api/books/:bookId/progress",
    zValidator("json", updateBookProgressRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      const book = await withDatabase((database) =>
        updateBookCurrentPage(database, c.req.param("bookId"), body.currentPage)
      );

      if (!book) {
        return c.json({ message: "Book not found." }, 404);
      }

      return c.json(bookDetailSchema.parse(book));
    }
  );

  app.patch(
    "/api/books/:bookId/metadata",
    zValidator("json", updateBookMetadataRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      const book = await withDatabase((database) =>
        updateBookMetadata(database, c.req.param("bookId"), body)
      );

      if (!book) {
        return c.json({ message: "Book not found." }, 404);
      }

      return c.json(bookDetailSchema.parse(book));
    }
  );

  app.get("/api/books/:bookId/pages/:page/image", async (c) => {
    const bookId = c.req.param("bookId");
    const page = Number(c.req.param("page"));

    if (!Number.isInteger(page) || page < 1) {
      return c.json({ message: "Page not found." }, 404);
    }

    const persistedPage = await withDatabase((database) =>
      findBookPage(database, bookId, page)
    );

    if (persistedPage) {
      try {
        const image = await readPersistedPageImage(persistedPage);

        if (!image) {
          return c.json({ message: "Page image is not readable." }, 404);
        }

        return c.body(new Uint8Array(image), 200, {
          "Content-Type": getPageContentType(persistedPage),
          "Cache-Control": "no-store"
        });
      } catch {
        return c.json({ message: "Page image is not readable." }, 404);
      }
    }

    const sampleBook = findSampleBook(bookId);

    if (
      !sampleBook ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > sampleBook.pageCount
    ) {
      return c.json({ message: "Page not found." }, 404);
    }

    return c.body(renderSamplePageSvg(sampleBook, page), 200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store"
    });
  });

  app.use("/_nuxt/*", serveStatic({ root: publicDir }));
  app.use(
    "/favicon.ico",
    serveStatic({ path: join(publicDir, "favicon.ico") })
  );
  app.use("*", serveStatic({ root: publicDir }));
  app.get("*", serveStatic({ path: join(publicDir, "200.html") }));

  return app;
};

/**
 * Resolves the generated frontend assets next to the server package.
 */
const getDefaultPublicDir = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "../public");

/**
 * Selects persisted or sample books while preserving empty search results.
 */
const selectBookListResponseBooks = ({
  allBooks,
  matchingBooks,
  query,
  readingStatus,
  bookStatus,
  sampleBooks
}: {
  allBooks: BookSummary[];
  matchingBooks: BookSummary[];
  query: string;
  readingStatus: ReadingStatus | null;
  bookStatus: BookSummary["status"] | null;
  sampleBooks: BookSummary[];
}): BookSummary[] => {
  const selectedBooks =
    query.length > 0
      ? selectSearchedBookListResponseBooks({
          allBooks,
          matchingBooks,
          query,
          sampleBooks
        })
      : allBooks.length > 0
        ? allBooks
        : sampleBooks;

  return filterBookSummariesByStatus(
    filterBookSummariesByReadingStatus(selectedBooks, readingStatus),
    bookStatus
  );
};

/**
 * Selects searched persisted books or searched samples.
 */
const selectSearchedBookListResponseBooks = ({
  allBooks,
  matchingBooks,
  query,
  sampleBooks
}: {
  allBooks: BookSummary[];
  matchingBooks: BookSummary[];
  query: string;
  sampleBooks: BookSummary[];
}): BookSummary[] => {
  if (query.length > 0) {
    return allBooks.length > 0
      ? matchingBooks
      : filterBookSummaries(sampleBooks, query);
  }

  return allBooks.length > 0 ? allBooks : sampleBooks;
};

/**
 * Filters book summaries by reading status when a status filter is active.
 */
const filterBookSummariesByReadingStatus = (
  books: BookSummary[],
  readingStatus: ReadingStatus | null
): BookSummary[] =>
  readingStatus
    ? books.filter((book) => book.readingStatus === readingStatus)
    : books;

/**
 * Filters book summaries by source status when a status filter is active.
 */
const filterBookSummariesByStatus = (
  books: BookSummary[],
  bookStatus: BookSummary["status"] | null
): BookSummary[] =>
  bookStatus ? books.filter((book) => book.status === bookStatus) : books;

/**
 * Filters API book summaries for the sample library fallback.
 */
const filterBookSummaries = (
  books: BookSummary[],
  query: string
): BookSummary[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (normalizedQuery.length < 1) {
    return books;
  }

  return books.filter((book) =>
    [
      book.title,
      ...book.authors,
      book.format,
      book.status,
      book.readingStatus,
      ...book.tags
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  );
};

/**
 * Finds a persisted book or sample fallback.
 */
const findBook = async (
  bookId: string,
  withDatabase: <T>(
    callback: (database: BookCafeDatabase) => T | Promise<T>
  ) => Promise<T>
): Promise<BookDetail | null> => {
  const persistedBook = await withDatabase((database) =>
    findBookDetail(database, bookId)
  );

  return persistedBook ?? findSampleBook(bookId);
};

/**
 * Returns true when an API route must remain available without a session.
 */
const isPublicApiRoute = (path: string, method: string): boolean =>
  method === "OPTIONS" ||
  path === "/api/health" ||
  path === "/api/setup/status" ||
  (method === "POST" && path === "/api/setup/initial-user") ||
  path.startsWith("/api/auth/");

/**
 * Returns true when a collection root path exists and is a directory.
 */
const isReadableDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Converts a collection root row into an API response.
 */
const toCollectionRootResponse = (root: CollectionRootRow) => ({
  id: root.id,
  path: root.path,
  createdAt: root.createdAt.toISOString(),
  updatedAt: root.updatedAt.toISOString()
});

/**
 * Builds a stable download filename for a library export timestamp.
 */
const createLibraryExportFileName = (exportedAt: Date): string =>
  `bookcafe-library-${exportedAt
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z")}.json`;

/**
 * Converts a background job row into an API response.
 */
const toBackgroundJobResponse = (job: JobRecord) => ({
  id: job.id,
  type: job.type,
  status: job.status,
  payload: job.payload,
  progress: job.progress,
  error: job.error,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString()
});

/**
 * Reads a persisted page image from its original source.
 */
const readPersistedPageImage = async (
  page: Awaited<ReturnType<typeof findBookPage>>
): Promise<Uint8Array | Buffer | null> => {
  if (!page) {
    return null;
  }

  if (page.sourceType === "archive-entry") {
    return page.entryPath
      ? readArchiveImageEntry(page.sourcePath, page.entryPath)
      : null;
  }

  if (page.sourceType === "packed-archive-entry") {
    return page.entryPath
      ? readPackedArchiveImageEntry(page.sourcePath, page.entryPath)
      : null;
  }

  if (page.sourceType === "pdf-page") {
    return renderPdfPageImage(page.sourcePath, page.pageNumber);
  }

  if (page.sourceType === "epub-page") {
    return renderEpubPageImage(page.sourcePath, page.pageNumber);
  }

  return readFile(page.sourcePath);
};

/**
 * Returns the content type for a persisted page image response.
 */
const getPageContentType = (
  page: NonNullable<Awaited<ReturnType<typeof findBookPage>>>
): string => {
  if (page.sourceType === "pdf-page") {
    return "image/png";
  }

  if (page.sourceType === "epub-page") {
    return "image/png";
  }

  return getImageContentType(page.entryPath ?? page.sourcePath);
};

/**
 * Returns a simple image content type from a file extension.
 */
const getImageContentType = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  if (extension === ".avif") {
    return "image/avif";
  }

  return "application/octet-stream";
};
