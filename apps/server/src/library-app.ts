/**
 * Hono application for the single-SQLite, library-scoped BookCafe API.
 */

import { constants } from "node:fs";
import { access, readFile, realpath, stat, unlink } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  getDefaultStateDir,
  loadConfig,
  resolveStatePaths,
  saveConfig,
  type AppConfig
} from "@bookcafe/config";
import {
  apiErrorResponseSchema,
  backgroundJobListResponseSchema,
  backgroundJobSchema,
  bookDetailSchema,
  bookListQuerySchema,
  bookListResponseSchema,
  healthResponseSchema,
  initialSetupRequestSchema,
  libraryCreateRequestSchema,
  libraryListResponseSchema,
  libraryPreferenceSchema,
  librarySchema,
  libraryUpdateRequestSchema,
  networkSettingsSchema,
  scanFailureListQuerySchema,
  scanFailureListResponseSchema,
  setupStatusSchema,
  thumbnailSettingsSchema,
  updateBookMetadataRequestSchema,
  updateBookProgressRequestSchema,
  updateLibraryPreferenceRequestSchema,
  updateNetworkSettingsRequestSchema,
  updateThumbnailSettingsRequestSchema,
  type ApiErrorCode
} from "@bookcafe/contracts";
import {
  archiveBook,
  cancelJob,
  closeDatabase,
  createJob,
  createLibrary,
  deleteLibrary,
  findBookDetail,
  findBookPage,
  findBookThumbnail,
  findJob,
  findLibrary,
  getLibraryPreference,
  listBookSummaryPage,
  listJobs,
  listLibraries,
  listScanFailures,
  markInterruptedJobsFailed,
  openBookCafeDatabase,
  restoreBook,
  setLibraryPreference,
  updateBookMetadata,
  updateLibrary,
  updateReadingProgress,
  type BookCafeDatabase,
  type BookCafeDomainError,
  type JobRecord,
  type LibraryRecord,
  type ScanFailureRecord
} from "@bookcafe/db";
import {
  readArchiveImageEntry,
  readPackedArchiveImageEntry,
  renderEpubPageImage
} from "@bookcafe/format-adapters";
import { zValidator } from "@hono/zod-validator";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { isAPIError } from "better-auth/api";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import { getAuth, runAuthMigrations } from "./auth.js";
import {
  readInitializationState,
  type InitializationState
} from "./initialization.js";
import { createBookCafeJobQueue, type BookCafeJobQueue } from "./job-queue.js";
import { runLibraryScanJob } from "./library-scan-jobs.js";
import { isLoopbackAddress } from "./loopback.js";
import { getBookCafeClientOrigins } from "./origins.js";
import { renderPdfPageImageInChildProcess } from "./pdf-process.js";
import { createBufferResponse, createFileResponse } from "./byte-range.js";

type Auth = ReturnType<typeof getAuth>;

interface AppVariables {
  user: Auth["$Infer"]["Session"]["user"] | null;
  session: Auth["$Infer"]["Session"]["session"] | null;
}

export interface AppOptions {
  configPath?: string;
  stateDir?: string;
  jobQueue?: BookCafeJobQueue;
  publicDir?: string;
  readRemoteAddress?: (context: Context) => string | undefined;
}

/**
 * Creates the BookCafe Hono application.
 */
export const createApp = (options: AppOptions = {}) => {
  const stateDir = resolve(options.stateDir ?? getDefaultStateDir());
  const paths = resolveStatePaths(stateDir);
  const readConfig = (): AppConfig => loadConfig(options.configPath);
  const writeConfig = (config: AppConfig): AppConfig =>
    saveConfig(config, options.configPath);
  const initialConfig = readConfig();
  const auth = getAuth({
    databasePath: paths.databasePath,
    host: initialConfig.host,
    port: initialConfig.port
  });
  const app = new Hono<{ Variables: AppVariables }>();
  const jobQueue = options.jobQueue ?? createBookCafeJobQueue();
  const publicDir = options.publicDir ?? getDefaultPublicDir();
  const readRemoteAddress =
    options.readRemoteAddress ??
    ((context: Context): string | undefined =>
      getConnInfo(context).remote.address);
  const runInitialSetupExclusive = createExclusiveRunner();
  let readyPromise: Promise<void> | null = null;

  /**
   * Applies auth and domain migrations once before serving database requests.
   */
  const ensureReady = (): Promise<void> => {
    readyPromise ??= (async () => {
      await runAuthMigrations(auth);
      const database = openBookCafeDatabase(paths.databasePath);

      try {
        markInterruptedJobsFailed(database);
      } finally {
        closeDatabase(database);
      }
    })();

    return readyPromise;
  };

  /**
   * Reads initialization state from the shared database.
   */
  const readState = (): InitializationState =>
    readInitializationState(paths.databasePath);

  /**
   * Opens the shared database for one bounded operation.
   */
  const withDatabase = async <Value>(
    callback: (database: BookCafeDatabase) => Value | Promise<Value>
  ): Promise<Value> => {
    await ensureReady();
    const database = openBookCafeDatabase(paths.databasePath);

    try {
      return await callback(database);
    } finally {
      closeDatabase(database);
    }
  };

  app.onError((error, c) => {
    console.error(error);
    return c.json(
      createApiError("INTERNAL_ERROR", "Internal server error."),
      500
    );
  });

  app.use(
    "/api/*",
    cors({
      origin: getBookCafeClientOrigins(),
      allowHeaders: ["Content-Type", "Authorization", "Range", "If-Range"],
      allowMethods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: [
        "Accept-Ranges",
        "Content-Disposition",
        "Content-Length",
        "Content-Range",
        "ETag",
        "Last-Modified"
      ],
      credentials: true
    })
  );

  app.use("/api/*", async (c, next) => {
    await ensureReady();

    if (isPublicApiRoute(c.req.path)) {
      await next();
      return;
    }

    const state = readState();

    if (state.status === "unavailable") {
      return c.json(
        createApiError("DATA_UNAVAILABLE", "BookCafe data is unavailable."),
        503
      );
    }

    if (state.status === "uninitialized") {
      return c.json(
        createApiError("SETUP_REQUIRED", "Setup is required."),
        409
      );
    }

    const authenticated = await auth.api.getSession({
      headers: c.req.raw.headers
    });
    c.set("user", authenticated?.user ?? null);
    c.set("session", authenticated?.session ?? null);

    if (!authenticated?.user || !authenticated.session) {
      return c.json(
        createApiError("UNAUTHORIZED", "Authentication required."),
        401
      );
    }

    await next();
  });

  app.get("/api/health", (c) =>
    c.json(
      healthResponseSchema.parse({
        ok: true,
        service: "bookcafe-server"
      })
    )
  );

  app.get("/api/setup/status", (c) => {
    const state = readState();

    if (state.status === "unavailable") {
      return c.json(
        createApiError("DATA_UNAVAILABLE", "BookCafe data is unavailable."),
        503
      );
    }

    return c.json(
      setupStatusSchema.parse({
        setupComplete: state.status === "initialized"
      })
    );
  });

  app.post(
    "/api/setup/initial-user",
    async (c, next) => {
      let remoteAddress: string | undefined;

      try {
        remoteAddress = readRemoteAddress(c);
      } catch {
        remoteAddress = undefined;
      }

      if (!isLoopbackAddress(remoteAddress)) {
        return c.json(
          createApiError(
            "SETUP_LOCAL_ONLY",
            "Initial setup is available only from this device."
          ),
          403
        );
      }

      await next();
    },
    zValidator("json", initialSetupRequestSchema, (result, c) =>
      result.success
        ? undefined
        : c.json(
            createApiError(
              "INVALID_SETUP_INPUT",
              "Initial setup input is invalid."
            ),
            400
          )
    ),
    async (c) =>
      runInitialSetupExclusive(async () => {
        if (readState().status === "initialized") {
          return c.json(
            createApiError("ALREADY_INITIALIZED", "Setup is already complete."),
            409
          );
        }

        const body = c.req.valid("json");

        try {
          await auth.api.signUpEmail({
            body: {
              email: `${body.username}@bookcafe.local`,
              name: body.username,
              username: body.username,
              password: body.password
            },
            headers: c.req.raw.headers
          });
        } catch (error) {
          if (readState().status === "initialized") {
            return c.json(
              createApiError(
                "ALREADY_INITIALIZED",
                "Setup is already complete."
              ),
              409
            );
          }

          if (isAPIError(error)) {
            return c.json(
              createApiError(
                "INVALID_SETUP_INPUT",
                "Initial setup input is invalid."
              ),
              400
            );
          }

          throw error;
        }

        if (readState().status !== "initialized") {
          throw new Error("Initial user creation did not initialize BookCafe.");
        }

        return c.json(setupStatusSchema.parse({ setupComplete: true }), 201);
      })
  );

  app.on(["GET", "POST"], "/api/auth/get-session", async (c) => {
    if (readState().status !== "initialized") {
      return c.json(null);
    }

    return auth.handler(c.req.raw);
  });

  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    if (readState().status !== "initialized") {
      return c.json(
        createApiError("SETUP_REQUIRED", "Setup is required."),
        409
      );
    }

    if (isAuthSignUpRoute(c.req.path)) {
      return c.json(
        createApiError("SIGN_UP_DISABLED", "Account creation is disabled."),
        403
      );
    }

    return auth.handler(c.req.raw);
  });

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
    zValidator("json", updateNetworkSettingsRequestSchema, invalidInputHook),
    (c) => {
      const current = readConfig();
      const body = c.req.valid("json");
      const changed = current.host !== body.host || current.port !== body.port;
      const saved = writeConfig({ ...current, ...body });

      return c.json(
        networkSettingsSchema.parse({
          host: saved.host,
          port: saved.port,
          restartRequired: changed
        })
      );
    }
  );

  app.get("/api/settings/thumbnails", (c) =>
    c.json(thumbnailSettingsSchema.parse(readConfig().thumbnails))
  );

  app.patch(
    "/api/settings/thumbnails",
    zValidator("json", updateThumbnailSettingsRequestSchema, invalidInputHook),
    (c) => {
      const saved = writeConfig({
        ...readConfig(),
        thumbnails: c.req.valid("json")
      });
      return c.json(thumbnailSettingsSchema.parse(saved.thumbnails));
    }
  );

  app.get("/api/libraries", async (c) =>
    c.json(
      libraryListResponseSchema.parse({
        libraries: (await withDatabase(listLibraries)).map(toLibraryResponse)
      })
    )
  );

  app.post(
    "/api/libraries",
    zValidator("json", libraryCreateRequestSchema, invalidInputHook),
    async (c) => {
      const body = c.req.valid("json");
      const validatedRoot = await validateLibraryRoot(body.rootPath);

      if (!validatedRoot) {
        return c.json(
          createApiError(
            "INVALID_LIBRARY_PATH",
            "Library path must be an existing readable directory."
          ),
          400
        );
      }

      try {
        const library = await withDatabase((database) =>
          createLibrary(database, {
            name: body.name,
            rootPath: validatedRoot.rootPath,
            canonicalRootPath: validatedRoot.canonicalRootPath
          })
        );
        return c.json(librarySchema.parse(toLibraryResponse(library)), 201);
      } catch (error) {
        return handleLibraryDomainError(c, error);
      }
    }
  );

  app.get("/api/libraries/:libraryId", async (c) => {
    const library = await withDatabase((database) =>
      findLibrary(database, c.req.param("libraryId"))
    );
    return library
      ? c.json(librarySchema.parse(toLibraryResponse(library)))
      : c.json(createApiError("NOT_FOUND", "Library not found."), 404);
  });

  app.patch(
    "/api/libraries/:libraryId",
    zValidator("json", libraryUpdateRequestSchema, invalidInputHook),
    async (c) => {
      const body = c.req.valid("json");
      let validatedRoot:
        { rootPath: string; canonicalRootPath: string } | undefined;

      if (body.rootPath !== undefined) {
        validatedRoot = (await validateLibraryRoot(body.rootPath)) ?? undefined;

        if (!validatedRoot) {
          return c.json(
            createApiError(
              "INVALID_LIBRARY_PATH",
              "Library path must be an existing readable directory."
            ),
            400
          );
        }
      }

      try {
        const result = await withDatabase((database) =>
          updateLibrary(database, c.req.param("libraryId"), {
            name: body.name,
            rootPath: validatedRoot?.rootPath,
            canonicalRootPath: validatedRoot?.canonicalRootPath
          })
        );

        if (!result) {
          return c.json(createApiError("NOT_FOUND", "Library not found."), 404);
        }

        if ("status" in result) {
          return c.json(
            createApiError("LIBRARY_BUSY", "Library has an active job."),
            409
          );
        }

        return c.json(librarySchema.parse(toLibraryResponse(result)));
      } catch (error) {
        return handleLibraryDomainError(c, error);
      }
    }
  );

  app.delete("/api/libraries/:libraryId", async (c) => {
    const result = await withDatabase((database) =>
      deleteLibrary(database, c.req.param("libraryId"))
    );

    if (result.status === "not-found") {
      return c.json(createApiError("NOT_FOUND", "Library not found."), 404);
    }

    if (result.status === "busy") {
      return c.json(
        createApiError("LIBRARY_BUSY", "Library has an active job."),
        409
      );
    }

    await Promise.all(
      result.thumbnailPaths.map((path) =>
        unlinkCentralThumbnail(path, paths.thumbnailDir)
      )
    );
    return c.body(null, 204);
  });

  app.get("/api/users/me/library-preference", async (c) =>
    c.json(
      libraryPreferenceSchema.parse({
        libraryId: await withDatabase((database) =>
          getLibraryPreference(database, requireUserId(c))
        )
      })
    )
  );

  app.patch(
    "/api/users/me/library-preference",
    zValidator("json", updateLibraryPreferenceRequestSchema, invalidInputHook),
    async (c) => {
      const { libraryId } = c.req.valid("json");

      if (
        libraryId &&
        !(await withDatabase((database) => findLibrary(database, libraryId)))
      ) {
        return c.json(createApiError("NOT_FOUND", "Library not found."), 404);
      }

      return c.json(
        libraryPreferenceSchema.parse({
          libraryId: await withDatabase((database) =>
            setLibraryPreference(database, requireUserId(c), libraryId)
          )
        })
      );
    }
  );

  app.get("/api/libraries/:libraryId/books/archived", async (c) => {
    const query = bookListQuerySchema.safeParse(c.req.query());

    if (!query.success) {
      return c.json(
        createApiError("INVALID_INPUT", "Book pagination is invalid."),
        400
      );
    }

    const result = await withScopedLibrary(
      c,
      withDatabase,
      (database, library) =>
        listBookSummaryPage(database, library.id, {
          archived: true,
          offset: query.data.offset,
          limit: query.data.limit,
          userId: requireUserId(c)
        })
    );

    return result instanceof Response
      ? result
      : c.json(bookListResponseSchema.parse(result));
  });

  app.get("/api/libraries/:libraryId/books", async (c) => {
    const query = bookListQuerySchema.safeParse(c.req.query());

    if (!query.success) {
      return c.json(
        createApiError("INVALID_INPUT", "Book filters are invalid."),
        400
      );
    }

    const result = await withScopedLibrary(
      c,
      withDatabase,
      (database, library) =>
        listBookSummaryPage(database, library.id, {
          query: query.data.q,
          readingStatus: query.data.readingStatus,
          bookStatus: query.data.bookStatus,
          offset: query.data.offset,
          limit: query.data.limit,
          userId: requireUserId(c)
        })
    );

    return result instanceof Response
      ? result
      : c.json(bookListResponseSchema.parse(result));
  });

  app.get("/api/libraries/:libraryId/books/:bookId", async (c) => {
    const book = await withDatabase((database) =>
      findBookDetail(
        database,
        c.req.param("libraryId"),
        c.req.param("bookId"),
        requireUserId(c)
      )
    );
    return book
      ? c.json(bookDetailSchema.parse(book))
      : c.json(createApiError("NOT_FOUND", "Book not found."), 404);
  });

  app.patch(
    "/api/libraries/:libraryId/books/:bookId/metadata",
    zValidator("json", updateBookMetadataRequestSchema, invalidInputHook),
    async (c) => {
      const book = await withDatabase((database) =>
        updateBookMetadata(
          database,
          c.req.param("libraryId"),
          c.req.param("bookId"),
          c.req.valid("json")
        )
      );
      return book
        ? c.json(bookDetailSchema.parse(book))
        : c.json(createApiError("NOT_FOUND", "Book not found."), 404);
    }
  );

  app.patch(
    "/api/libraries/:libraryId/books/:bookId/progress",
    zValidator("json", updateBookProgressRequestSchema, invalidInputHook),
    async (c) => {
      const book = await withDatabase((database) =>
        updateReadingProgress(
          database,
          requireUserId(c),
          c.req.param("libraryId"),
          c.req.param("bookId"),
          c.req.valid("json").currentPage
        )
      );
      return book
        ? c.json(bookDetailSchema.parse(book))
        : c.json(createApiError("NOT_FOUND", "Book not found."), 404);
    }
  );

  app.post("/api/libraries/:libraryId/books/:bookId/archive", async (c) => {
    const book = await withDatabase((database) =>
      archiveBook(database, c.req.param("libraryId"), c.req.param("bookId"))
    );
    return book
      ? c.json(bookDetailSchema.parse(book))
      : c.json(createApiError("NOT_FOUND", "Book not found."), 404);
  });

  app.post("/api/libraries/:libraryId/books/:bookId/restore", async (c) => {
    const book = await withDatabase((database) =>
      restoreBook(database, c.req.param("libraryId"), c.req.param("bookId"))
    );
    return book
      ? c.json(bookDetailSchema.parse(book))
      : c.json(createApiError("NOT_FOUND", "Book not found."), 404);
  });

  app.on(
    ["GET", "HEAD"],
    "/api/libraries/:libraryId/books/:bookId/source",
    async (c) => {
      const source = await withDatabase((database) => {
        const library = findLibrary(database, c.req.param("libraryId"));
        const book = findBookDetail(
          database,
          c.req.param("libraryId"),
          c.req.param("bookId"),
          requireUserId(c)
        );
        return library && book ? { library, book } : null;
      });

      if (
        !source ||
        source.book.status === "missing" ||
        source.book.format === "image-folder"
      ) {
        return c.json(
          createApiError("NOT_FOUND", "Book source not found."),
          404
        );
      }

      try {
        const sourcePath = await resolveLibrarySource(
          source.library.canonicalRootPath,
          source.book.relativePath
        );
        return await createFileResponse({
          request: c.req.raw,
          filePath: sourcePath,
          contentType: getBookSourceContentType(source.book.relativePath),
          cacheControl: "private, no-cache",
          dispositionFileName: basename(source.book.relativePath)
        });
      } catch {
        return c.json(
          createApiError("NOT_FOUND", "Book source not found."),
          404
        );
      }
    }
  );

  app.on(
    ["GET", "HEAD"],
    "/api/libraries/:libraryId/books/:bookId/pages/:pageNumber/image",
    async (c) => {
      const pageNumber = Number(c.req.param("pageNumber"));

      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        return c.json(
          createApiError("INVALID_INPUT", "Page number is invalid."),
          400
        );
      }

      const source = await withDatabase((database) => {
        const library = findLibrary(database, c.req.param("libraryId"));
        const book = findBookDetail(
          database,
          c.req.param("libraryId"),
          c.req.param("bookId"),
          requireUserId(c)
        );
        const page = findBookPage(
          database,
          c.req.param("libraryId"),
          c.req.param("bookId"),
          pageNumber
        );
        return library && book && page ? { library, book, page } : null;
      });

      if (!source || source.book.status === "missing") {
        return c.json(createApiError("NOT_FOUND", "Page not found."), 404);
      }

      if (source.page.sourceType === "file" && source.page.relativePath) {
        try {
          const sourcePath = await resolveLibrarySource(
            source.library.canonicalRootPath,
            source.page.relativePath
          );
          return await createFileResponse({
            request: c.req.raw,
            filePath: sourcePath,
            contentType:
              source.page.mimeType ??
              getImageContentType(source.page.relativePath),
            cacheControl: "private, max-age=60"
          });
        } catch {
          return c.json(createApiError("NOT_FOUND", "Page not found."), 404);
        }
      }

      const image = await readPageImage(source, c.req.raw.signal);

      if (!image) {
        return c.json(createApiError("NOT_FOUND", "Page not found."), 404);
      }

      return createBufferResponse({
        request: c.req.raw,
        data: image,
        cacheControl: "private, max-age=60",
        contentType:
          source.page.mimeType ??
          getImageContentType(source.page.entryPath ?? source.page.relativePath)
      });
    }
  );

  app.get("/api/libraries/:libraryId/books/:bookId/thumbnail", async (c) => {
    const thumbnail = await withDatabase((database) =>
      findBookThumbnail(
        database,
        c.req.param("libraryId"),
        c.req.param("bookId")
      )
    );

    if (!thumbnail) {
      return c.json(createApiError("NOT_FOUND", "Thumbnail not found."), 404);
    }

    try {
      return new Response(await readFile(thumbnail.path), {
        headers: {
          "Cache-Control": "private, max-age=300",
          "Content-Type": "image/webp"
        }
      });
    } catch {
      return c.json(createApiError("NOT_FOUND", "Thumbnail not found."), 404);
    }
  });

  app.get("/api/libraries/:libraryId/jobs", async (c) => {
    const jobs = await withDatabase((database) =>
      findLibrary(database, c.req.param("libraryId"))
        ? listJobs(database, c.req.param("libraryId"))
        : null
    );
    return jobs
      ? c.json(
          backgroundJobListResponseSchema.parse({
            jobs: jobs.map(toJobResponse)
          })
        )
      : c.json(createApiError("NOT_FOUND", "Library not found."), 404);
  });

  app.get("/api/libraries/:libraryId/jobs/:jobId", async (c) => {
    const job = await withDatabase((database) =>
      findJob(database, c.req.param("libraryId"), c.req.param("jobId"))
    );
    return job
      ? c.json(backgroundJobSchema.parse(toJobResponse(job)))
      : c.json(createApiError("NOT_FOUND", "Job not found."), 404);
  });

  app.get("/api/libraries/:libraryId/jobs/:jobId/failures", async (c) => {
    const query = scanFailureListQuerySchema.safeParse(c.req.query());

    if (!query.success) {
      return c.json(
        createApiError("INVALID_INPUT", "Scan failure pagination is invalid."),
        400
      );
    }

    const page = await withDatabase((database) =>
      listScanFailures(
        database,
        c.req.param("libraryId"),
        c.req.param("jobId"),
        query.data
      )
    );

    return page
      ? c.json(
          scanFailureListResponseSchema.parse({
            ...page,
            failures: page.failures.map(toScanFailureResponse)
          })
        )
      : c.json(createApiError("NOT_FOUND", "Job not found."), 404);
  });

  app.post("/api/libraries/:libraryId/jobs/scan", async (c) => {
    const config = readConfig();
    const job = await withDatabase((database) => {
      const library = findLibrary(database, c.req.param("libraryId"));

      if (!library) {
        return { status: "not-found" as const };
      }

      if (
        listJobs(database, library.id).some(
          (item) => item.status === "queued" || item.status === "running"
        )
      ) {
        return { status: "busy" as const };
      }

      return {
        status: "created" as const,
        job: createJob(database, {
          libraryId: library.id,
          type: "scan-library",
          payload: {}
        })
      };
    });

    if (job.status !== "created") {
      return job.status === "not-found"
        ? c.json(createApiError("NOT_FOUND", "Library not found."), 404)
        : c.json(
            createApiError("LIBRARY_BUSY", "Library has an active job."),
            409
          );
    }

    jobQueue.add(job.job.id, (signal) =>
      runLibraryScanJob({
        databasePath: paths.databasePath,
        thumbnailDir: paths.thumbnailDir,
        thumbnailsEnabled: config.thumbnails.enabled,
        libraryId: job.job.libraryId,
        jobId: job.job.id,
        signal
      })
    );

    return c.json(backgroundJobSchema.parse(toJobResponse(job.job)), 201);
  });

  app.delete("/api/libraries/:libraryId/jobs/:jobId", async (c) => {
    const result = await withDatabase((database) =>
      cancelJob(database, c.req.param("libraryId"), c.req.param("jobId"))
    );

    if (result === "not-found") {
      return c.json(createApiError("NOT_FOUND", "Job not found."), 404);
    }

    if (result === "not-cancellable") {
      return c.json(
        createApiError("INVALID_INPUT", "Job cannot be cancelled."),
        409
      );
    }

    jobQueue.cancel(c.req.param("jobId"));
    const job = await withDatabase((database) =>
      findJob(database, c.req.param("libraryId"), c.req.param("jobId"))
    );
    return c.json(backgroundJobSchema.parse(toJobResponse(job as JobRecord)));
  });

  app.use(
    "*",
    serveStatic({
      root: publicDir
    })
  );

  app.get("*", async (c) => {
    try {
      return c.html(await readFile(join(publicDir, "200.html"), "utf8"));
    } catch {
      return c.notFound();
    }
  });

  return app;
};

type WithDatabase = <Value>(
  callback: (database: BookCafeDatabase) => Value | Promise<Value>
) => Promise<Value>;

/**
 * Runs a callback only when the URL library exists.
 */
const withScopedLibrary = async <Value>(
  context: Context,
  withDatabase: WithDatabase,
  callback: (database: BookCafeDatabase, library: LibraryRecord) => Value
): Promise<Value | Response> =>
  withDatabase((database) => {
    const library = findLibrary(database, context.req.param("libraryId") ?? "");
    return library
      ? callback(database, library)
      : context.json(createApiError("NOT_FOUND", "Library not found."), 404);
  });

/**
 * Returns the authenticated user id established by API middleware.
 */
const requireUserId = (context: Context): string => {
  const user = context.get("user") as { id?: string } | null;

  if (!user?.id) {
    throw new Error("Authenticated user is missing.");
  }

  return user.id;
};

/**
 * Converts an internal library record to its authenticated API representation.
 */
const toLibraryResponse = (library: LibraryRecord) => ({
  id: library.id,
  name: library.name,
  rootPath: library.rootPath,
  createdAt: library.createdAt.toISOString(),
  updatedAt: library.updatedAt.toISOString()
});

/**
 * Converts a background job to its API representation.
 */
const toJobResponse = (job: JobRecord) => ({
  id: job.id,
  libraryId: job.libraryId,
  type: job.type,
  status: job.status,
  payload: job.payload,
  progress: job.progress,
  error: job.error,
  canCancel: job.status === "queued" || job.status === "running",
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString()
});

/**
 * Converts one persisted scan failure to its path-safe API representation.
 */
const toScanFailureResponse = (failure: ScanFailureRecord) => ({
  id: failure.id,
  jobId: failure.jobId,
  kind: failure.kind,
  relativePath: failure.relativePath,
  format: failure.format,
  code: failure.code,
  createdAt: failure.createdAt.toISOString()
});

/**
 * Validates and canonicalizes a server-side absolute library directory.
 */
const validateLibraryRoot = async (
  rootPath: string
): Promise<{ rootPath: string; canonicalRootPath: string } | null> => {
  if (!isAbsolute(rootPath)) {
    return null;
  }

  try {
    const resolvedRootPath = resolve(rootPath);
    await access(resolvedRootPath, constants.R_OK);
    const rootStat = await stat(resolvedRootPath);

    if (!rootStat.isDirectory()) {
      return null;
    }

    return {
      rootPath: resolvedRootPath,
      canonicalRootPath: await realpath(resolvedRootPath)
    };
  } catch {
    return null;
  }
};

interface ReadPageImageInput {
  library: LibraryRecord;
  book: ReturnType<typeof findBookDetail> extends infer Value
    ? Exclude<Value, null>
    : never;
  page: ReturnType<typeof findBookPage> extends infer Value
    ? Exclude<Value, null>
    : never;
}

/**
 * Reads or renders a page using only canonical root and relative locators.
 */
const readPageImage = async (
  { library, page }: ReadPageImageInput,
  signal?: AbortSignal
): Promise<Uint8Array | null> => {
  if (!page.relativePath) {
    return null;
  }

  let sourcePath: string;

  try {
    sourcePath = await resolveLibrarySource(
      library.canonicalRootPath,
      page.relativePath
    );
  } catch {
    return null;
  }

  if (page.sourceType === "file") {
    try {
      return new Uint8Array(await readFile(sourcePath));
    } catch {
      return null;
    }
  }

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
    try {
      return await renderPdfPageImageInChildProcess(
        sourcePath,
        page.sourcePageNumber,
        {},
        signal
      );
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  }

  if (page.sourceType === "epub-page" && page.sourcePageNumber) {
    return renderEpubPageImage(sourcePath, page.sourcePageNumber);
  }

  return null;
};

/**
 * Resolves a relative source while proving it remains within a library root.
 */
const resolveLibrarySource = async (
  canonicalRootPath: string,
  relativePath: string
): Promise<string> => {
  const sourcePath = resolve(canonicalRootPath, relativePath);
  const pathFromRoot = relative(canonicalRootPath, sourcePath);

  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Source path escaped the library root.");
  }

  const canonicalSourcePath = await realpath(sourcePath);
  const canonicalPathFromRoot = relative(
    canonicalRootPath,
    canonicalSourcePath
  );

  if (
    canonicalPathFromRoot.startsWith("..") ||
    isAbsolute(canonicalPathFromRoot)
  ) {
    throw new Error("Source path escaped the library root.");
  }

  return canonicalSourcePath;
};

/**
 * Infers a safe response MIME type from an image locator.
 */
const getImageContentType = (path: string | null): string => {
  const extension = extname(path ?? "").toLocaleLowerCase();

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".avif") {
    return "image/avif";
  }

  return "image/png";
};

/**
 * Infers the response MIME type for every supported file-backed book format.
 */
const getBookSourceContentType = (path: string): string => {
  const extension = extname(path).toLocaleLowerCase();

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".epub") {
    return "application/epub+zip";
  }

  if (extension === ".rar" || extension === ".cbr") {
    return "application/vnd.rar";
  }

  if (extension === ".7z") {
    return "application/x-7z-compressed";
  }

  if (extension === ".zip" || extension === ".cbz") {
    return "application/zip";
  }

  return "application/octet-stream";
};

/**
 * Removes a thumbnail only when its path is inside the central thumbnail dir.
 */
const unlinkCentralThumbnail = async (
  thumbnailPath: string,
  thumbnailDir: string
): Promise<void> => {
  const resolvedThumbnailPath = resolve(thumbnailPath);
  const pathFromThumbnailDir = relative(
    resolve(thumbnailDir),
    resolvedThumbnailPath
  );

  if (
    pathFromThumbnailDir.startsWith("..") ||
    isAbsolute(pathFromThumbnailDir)
  ) {
    return;
  }

  try {
    await unlink(resolvedThumbnailPath);
  } catch {
    // Missing central thumbnail files do not block metadata deletion.
  }
};

/**
 * Maps domain conflicts to stable API responses.
 */
const handleLibraryDomainError = (
  context: Context,
  error: unknown
): Response => {
  const code =
    error instanceof Error && "code" in error
      ? (error as BookCafeDomainError).code
      : null;

  if (code === "LIBRARY_NAME_CONFLICT") {
    return context.json(
      createApiError(
        "LIBRARY_NAME_CONFLICT",
        "A library with the same name already exists."
      ),
      409
    );
  }

  if (code === "LIBRARY_PATH_CONFLICT") {
    return context.json(
      createApiError(
        "LIBRARY_PATH_CONFLICT",
        "Library path overlaps another library."
      ),
      409
    );
  }

  throw error;
};

/**
 * Creates a validated stable API error body.
 */
const createApiError = (code: ApiErrorCode, message: string) =>
  apiErrorResponseSchema.parse({ code, message });

/**
 * Converts JSON schema failures to the shared API error representation.
 */
const invalidInputHook = (result: { success: boolean }, context: Context) =>
  result.success
    ? undefined
    : context.json(
        createApiError("INVALID_INPUT", "Request body is invalid."),
        400
      );

/**
 * Returns whether a route is available before authentication.
 */
const isPublicApiRoute = (path: string): boolean =>
  path === "/api/health" ||
  path === "/api/setup/status" ||
  path === "/api/setup/initial-user" ||
  path.startsWith("/api/auth/");

/**
 * Detects Better Auth signup routes that must remain disabled after setup.
 */
const isAuthSignUpRoute = (path: string): boolean =>
  path.includes("/sign-up/") || path.endsWith("/sign-up");

/**
 * Serializes an async mutation without introducing a class.
 */
const createExclusiveRunner = () => {
  let pending: Promise<void> = Promise.resolve();

  return async <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const result = pending.then(operation, operation);
    pending = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
};

/**
 * Returns the production directory containing generated Nuxt assets.
 */
const getDefaultPublicDir = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");
