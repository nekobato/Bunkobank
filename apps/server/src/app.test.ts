import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, resolveDataPaths, saveConfig } from "@bookcafe/config";
import {
  closeDatabase,
  createJob,
  listBookSummaries,
  listJobs,
  markJobCompleted,
  markJobRunning,
  openBookCafeDatabase,
  persistScannedBook,
  updateBookMetadata,
  upsertCollectionRoot
} from "@bookcafe/db";
import sharp from "sharp";

import { createApp } from "./app.js";
import { createBookCafeJobQueue } from "./job-queue.js";

const tempDirs: string[] = [];
const testUser = {
  username: "admin",
  password: "password123"
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("BookCafe Hono app", () => {
  it("returns health information", async () => {
    const { configPath } = createTestConfig();
    const app = createApp({ configPath });
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "bookcafe-server"
    });
  });

  it("serves frontend assets independent of the process cwd", async () => {
    const { dir, configPath } = createTestConfig();
    const publicDir = join(dir, "public");
    mkdirSync(join(publicDir, "_nuxt"), { recursive: true });
    writeFileSync(join(publicDir, "index.html"), "<h1>BookCafe</h1>");
    writeFileSync(join(publicDir, "200.html"), "<h1>Fallback</h1>");
    writeFileSync(join(publicDir, "_nuxt", "entry.js"), "export {};");

    const app = createApp({ configPath, publicDir });
    const previousCwd = process.cwd();

    try {
      process.chdir(dir);

      const rootResponse = await app.request("/");
      const assetResponse = await app.request("/_nuxt/entry.js");
      const fallbackResponse = await app.request("/books/sample/read");

      expect(rootResponse.status).toBe(200);
      expect(await rootResponse.text()).toContain("BookCafe");
      expect(assetResponse.status).toBe(200);
      expect(await assetResponse.text()).toBe("export {};");
      expect(fallbackResponse.status).toBe(200);
      expect(await fallbackResponse.text()).toContain("Fallback");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("fails interrupted jobs when the app starts", () => {
    const { dir, configPath } = createTestConfig();

    saveConfig(
      {
        dataDir: dir,
        host: "127.0.0.1",
        port: 4510,
        thumbnails: { enabled: true },
        setupComplete: true
      },
      configPath
    );

    const database = openBookCafeDatabase(resolveDataPaths(dir).databasePath);
    let queuedJobId = "";
    let runningJobId = "";
    let completedJobId = "";

    try {
      const queuedJob = createJob(database, {
        type: "scan-collection-root",
        payload: { collectionRootId: "queued-root" }
      });
      const runningJob = createJob(database, {
        type: "scan-collection-root",
        payload: { collectionRootId: "running-root" }
      });
      const completedJob = createJob(database, {
        type: "scan-collection-root",
        payload: { collectionRootId: "completed-root" }
      });

      queuedJobId = queuedJob.id;
      runningJobId = runningJob.id;
      completedJobId = completedJob.id;

      markJobRunning(database, runningJob.id);
      markJobRunning(database, completedJob.id);
      markJobCompleted(database, completedJob.id);
    } finally {
      closeDatabase(database);
    }

    createApp({ configPath });

    const verifiedDatabase = openBookCafeDatabase(
      resolveDataPaths(dir).databasePath
    );

    try {
      const jobsById = new Map(
        listJobs(verifiedDatabase).map((job) => [job.id, job])
      );

      expect(jobsById.get(queuedJobId)?.status).toBe("failed");
      expect(jobsById.get(runningJobId)?.status).toBe("failed");
      expect(jobsById.get(completedJobId)?.status).toBe("completed");
    } finally {
      closeDatabase(verifiedDatabase);
    }
  });

  it("requires setup and authentication before serving books", async () => {
    const { configPath } = createTestConfig();
    const app = createApp({ configPath });
    const setupRequiredResponse = await app.request("/api/books");
    const sessionResponse = await app.request("/api/auth/get-session");

    await initializeUser(app);

    const unauthorizedResponse = await app.request("/api/books");
    const cookie = await signInUser(app);
    const response = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const body = await response.json();

    expect(setupRequiredResponse.status).toBe(409);
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toBeNull();
    expect(unauthorizedResponse.status).toBe(401);
    expect(response.status).toBe(200);
    expect(body.books[0].id).toBe("sample-manga");
  });

  it("returns setup network settings and saves the initial bind host", async () => {
    const { configPath } = createTestConfig({ port: 4517 });
    const app = createApp({ configPath });
    const statusResponse = await app.request("/api/setup/status");
    const setupResponse = await app.request("/api/setup/initial-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...testUser,
        host: "0.0.0.0",
        port: 4518,
        thumbnails: { enabled: false }
      })
    });
    const savedConfig = loadConfig(configPath);

    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({
      setupComplete: false,
      host: "127.0.0.1",
      port: 4517,
      thumbnails: { enabled: true }
    });
    expect(setupResponse.status).toBe(201);
    expect(await setupResponse.json()).toEqual({
      setupComplete: true,
      host: "0.0.0.0",
      port: 4518,
      thumbnails: { enabled: false }
    });
    expect(savedConfig).toMatchObject({
      host: "0.0.0.0",
      port: 4518,
      thumbnails: { enabled: false },
      setupComplete: true
    });
  });

  it("lets authenticated users manage persisted network settings", async () => {
    const { configPath } = createTestConfig({ port: 4519 });
    const app = createApp({ configPath });
    const setupResponse = await app.request("/api/setup/initial-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...testUser,
        port: 4519
      })
    });
    const unauthorizedResponse = await app.request("/api/settings/network");
    const cookie = await signInUser(app);
    const currentResponse = await app.request("/api/settings/network", {
      headers: { Cookie: cookie }
    });
    const updateResponse = await app.request("/api/settings/network", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        host: "0.0.0.0",
        port: 4520
      })
    });
    const repeatedUpdateResponse = await app.request("/api/settings/network", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        host: "0.0.0.0",
        port: 4520
      })
    });
    const savedConfig = loadConfig(configPath);

    expect(setupResponse.status).toBe(201);
    expect(unauthorizedResponse.status).toBe(401);
    expect(currentResponse.status).toBe(200);
    expect(await currentResponse.json()).toEqual({
      host: "127.0.0.1",
      port: 4519,
      restartRequired: false
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({
      host: "0.0.0.0",
      port: 4520,
      restartRequired: true
    });
    expect(repeatedUpdateResponse.status).toBe(200);
    expect(await repeatedUpdateResponse.json()).toEqual({
      host: "0.0.0.0",
      port: 4520,
      restartRequired: false
    });
    expect(savedConfig).toMatchObject({
      host: "0.0.0.0",
      port: 4520,
      setupComplete: true
    });
  });

  it("lets authenticated users manage thumbnail settings", async () => {
    const { configPath } = createTestConfig();
    const app = createApp({ configPath });

    await initializeUser(app);

    const unauthorizedResponse = await app.request("/api/settings/thumbnails");
    const cookie = await signInUser(app);
    const currentResponse = await app.request("/api/settings/thumbnails", {
      headers: { Cookie: cookie }
    });
    const updateResponse = await app.request("/api/settings/thumbnails", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ enabled: false })
    });
    const savedConfig = loadConfig(configPath);

    expect(unauthorizedResponse.status).toBe(401);
    expect(currentResponse.status).toBe(200);
    expect(await currentResponse.json()).toEqual({ enabled: true });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({ enabled: false });
    expect(savedConfig.thumbnails.enabled).toBe(false);
  });

  it("searches authenticated book lists with q", async () => {
    const { dir, configPath } = createTestConfig();
    const app = createApp({ configPath });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const database = openBookCafeDatabase(resolveDataPaths(dir).databasePath);

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const alphaPath = join(dir, "collection", "Alpha Manga");
      const betaPath = join(dir, "collection", "Beta Novel");

      persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Alpha Manga",
        authors: ["Clamp"],
        sourcePath: alphaPath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(alphaPath, "001.jpg")
          }
        ]
      });
      persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Beta Novel",
        authors: ["Writer"],
        sourcePath: betaPath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(betaPath, "001.jpg")
          }
        ]
      });
      persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Gamma Missing",
        authors: ["Archivist"],
        sourcePath: join(dir, "collection", "Gamma Missing"),
        format: "image-folder",
        status: "missing",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(dir, "collection", "Gamma Missing", "001.jpg")
          }
        ]
      });
      const betaBook = listBookSummaries(database).find(
        (book) => book.title === "Beta Novel"
      );

      if (!betaBook) {
        throw new Error("Beta Novel was not persisted.");
      }

      updateBookMetadata(database, betaBook.id, {
        title: "Beta Novel",
        authors: ["Writer"],
        publisher: null,
        isbn: null,
        purchasedAt: null,
        readingStatus: "finished",
        tags: ["Shelf Pick"],
        notes: null
      });
    } finally {
      closeDatabase(database);
    }

    const authorResponse = await app.request("/api/books?q=Clamp", {
      headers: { Cookie: cookie }
    });
    const emptyResponse = await app.request("/api/books?q=no-match", {
      headers: { Cookie: cookie }
    });
    const tagResponse = await app.request("/api/books?q=Shelf%20Pick", {
      headers: { Cookie: cookie }
    });
    const finishedResponse = await app.request(
      "/api/books?readingStatus=finished",
      {
        headers: { Cookie: cookie }
      }
    );
    const unreadSearchResponse = await app.request(
      "/api/books?q=Novel&readingStatus=unread",
      {
        headers: { Cookie: cookie }
      }
    );
    const missingResponse = await app.request("/api/books?bookStatus=missing", {
      headers: { Cookie: cookie }
    });
    const readyFinishedResponse = await app.request(
      "/api/books?readingStatus=finished&bookStatus=ready",
      {
        headers: { Cookie: cookie }
      }
    );
    const authorBody = await authorResponse.json();
    const emptyBody = await emptyResponse.json();
    const tagBody = await tagResponse.json();
    const finishedBody = await finishedResponse.json();
    const unreadSearchBody = await unreadSearchResponse.json();
    const missingBody = await missingResponse.json();
    const readyFinishedBody = await readyFinishedResponse.json();

    expect(authorResponse.status).toBe(200);
    expect(authorBody.books).toEqual([
      expect.objectContaining({
        title: "Alpha Manga",
        authors: ["Clamp"]
      })
    ]);
    expect(emptyResponse.status).toBe(200);
    expect(emptyBody.books).toEqual([]);
    expect(tagResponse.status).toBe(200);
    expect(tagBody.books).toEqual([
      expect.objectContaining({
        title: "Beta Novel",
        tags: ["Shelf Pick"]
      })
    ]);
    expect(finishedResponse.status).toBe(200);
    expect(finishedBody.books).toEqual([
      expect.objectContaining({
        title: "Beta Novel",
        readingStatus: "finished"
      })
    ]);
    expect(unreadSearchResponse.status).toBe(200);
    expect(unreadSearchBody.books).toEqual([]);
    expect(missingResponse.status).toBe(200);
    expect(missingBody.books).toEqual([
      expect.objectContaining({
        title: "Gamma Missing",
        status: "missing"
      })
    ]);
    expect(readyFinishedResponse.status).toBe(200);
    expect(readyFinishedBody.books).toEqual([
      expect.objectContaining({
        title: "Beta Novel",
        readingStatus: "finished",
        status: "ready"
      })
    ]);
  });

  it("exports authenticated library metadata as JSON", async () => {
    const { dir, configPath } = createTestConfig();
    const app = createApp({ configPath });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const database = openBookCafeDatabase(resolveDataPaths(dir).databasePath);

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const sourcePath = join(dir, "collection", "Export Volume");
      const book = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Export Volume",
        authors: ["Scanner Author"],
        sourcePath,
        format: "image-folder",
        pageCount: 2,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          },
          {
            pageNumber: 2,
            sourcePath: join(sourcePath, "002.jpg")
          }
        ]
      });

      updateBookMetadata(database, book.id, {
        title: "Edited Export Volume",
        authors: ["Manual Author"],
        publisher: "Publisher",
        isbn: "9780000000000",
        purchasedAt: "2026-07-10",
        readingStatus: "finished",
        tags: ["Portable"],
        notes: "Exported note"
      });
    } finally {
      closeDatabase(database);
    }

    const response = await app.request("/api/library/export", {
      headers: { Cookie: cookie }
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="bookcafe-library-\d{8}T\d{6}Z\.json"$/
    );
    expect(body).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        collectionRoots: [
          expect.objectContaining({
            path: join(dir, "collection")
          })
        ],
        books: [
          expect.objectContaining({
            title: "Edited Export Volume",
            authors: ["Manual Author"],
            sourcePath: join(dir, "collection", "Export Volume"),
            readingStatus: "finished",
            tags: ["Portable"],
            notes: "Exported note"
          })
        ]
      })
    );
  });

  it("updates authenticated book metadata", async () => {
    const { dir, configPath } = createTestConfig();
    const app = createApp({ configPath });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const database = openBookCafeDatabase(resolveDataPaths(dir).databasePath);
    let bookId = "";

    try {
      const root = upsertCollectionRoot(database, join(dir, "collection"));
      const sourcePath = join(dir, "collection", "Volume 1");
      const book = persistScannedBook(database, {
        collectionRootId: root.id,
        title: "Volume 1",
        authors: ["Scanner Author"],
        sourcePath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          }
        ]
      });

      bookId = book.id;
    } finally {
      closeDatabase(database);
    }

    const response = await app.request(`/api/books/${bookId}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: "Edited Volume",
        authors: ["Manual Author"],
        publisher: "Publisher",
        isbn: "9780000000000",
        purchasedAt: "2026-07-09",
        readingStatus: "finished",
        tags: ["Manga", "Favorite"],
        notes: "Shelf note"
      })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        title: "Edited Volume",
        authors: ["Manual Author"],
        publisher: "Publisher",
        isbn: "9780000000000",
        purchasedAt: "2026-07-09",
        readingStatus: "finished",
        tags: ["Manga", "Favorite"],
        notes: "Shelf note"
      })
    );
  });

  it("trusts the configured server origin for username sign-in", async () => {
    const { configPath } = createTestConfig({ port: 4513 });
    const origin = "http://127.0.0.1:4513";
    const app = createApp({ configPath });
    const setupResponse = await app.request("/api/setup/initial-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        ...testUser,
        port: 4513
      })
    });
    const signInResponse = await app.request("/api/auth/sign-in/username", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(testUser)
    });
    const cookie = getCookieHeader(signInResponse);
    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie, Origin: origin }
    });

    expect(setupResponse.status).toBe(201);
    expect(signInResponse.status).toBe(200);
    expect(cookie).not.toBe("");
    expect(booksResponse.status).toBe(200);
  });

  it("rejects collection roots that are not readable directories", async () => {
    const { dir, configPath } = createTestConfig();
    const app = createApp({ configPath });
    const filePath = join(dir, "not-a-directory.txt");
    const missingPath = join(dir, "missing");
    writeFileSync(filePath, "not a directory");

    await initializeUser(app);

    const cookie = await signInUser(app);
    const fileResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: filePath })
    });
    const missingResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: missingPath })
    });
    const rootsResponse = await app.request("/api/collection-roots", {
      headers: { Cookie: cookie }
    });
    const rootsBody = await rootsResponse.json();

    expect(fileResponse.status).toBe(400);
    expect(await fileResponse.json()).toEqual({
      message: "Collection root must be a readable directory."
    });
    expect(missingResponse.status).toBe(400);
    expect(await missingResponse.json()).toEqual({
      message: "Collection root must be a readable directory."
    });
    expect(rootsBody.roots).toEqual([]);
  });

  it("lets authenticated users delete only empty collection roots", async () => {
    const { dir, configPath } = createTestConfig();
    const emptyCollectionPath = join(dir, "empty-collection");
    const populatedCollectionPath = join(dir, "populated-collection");
    const sourcePath = join(populatedCollectionPath, "Volume 1");
    mkdirSync(emptyCollectionPath, { recursive: true });
    mkdirSync(sourcePath, { recursive: true });

    const app = createApp({ configPath });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const database = openBookCafeDatabase(resolveDataPaths(dir).databasePath);

    let emptyRootId = "";
    let populatedRootId = "";

    try {
      const emptyRoot = upsertCollectionRoot(database, emptyCollectionPath);
      const populatedRoot = upsertCollectionRoot(
        database,
        populatedCollectionPath
      );

      emptyRootId = emptyRoot.id;
      populatedRootId = populatedRoot.id;

      persistScannedBook(database, {
        collectionRootId: populatedRoot.id,
        title: "Volume 1",
        sourcePath,
        format: "image-folder",
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            sourcePath: join(sourcePath, "001.jpg")
          }
        ]
      });
    } finally {
      closeDatabase(database);
    }

    const unauthorizedResponse = await app.request(
      `/api/collection-roots/${emptyRootId}`,
      {
        method: "DELETE"
      }
    );
    const populatedResponse = await app.request(
      `/api/collection-roots/${populatedRootId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookie }
      }
    );
    const missingResponse = await app.request(
      "/api/collection-roots/missing-root",
      {
        method: "DELETE",
        headers: { Cookie: cookie }
      }
    );
    const emptyResponse = await app.request(
      `/api/collection-roots/${emptyRootId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookie }
      }
    );
    const rootsResponse = await app.request("/api/collection-roots", {
      headers: { Cookie: cookie }
    });
    const rootsBody = await rootsResponse.json();

    expect(unauthorizedResponse.status).toBe(401);
    expect(populatedResponse.status).toBe(409);
    expect(await populatedResponse.json()).toEqual({
      message: "Collection root contains scanned books."
    });
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({
      message: "Collection root not found."
    });
    expect(emptyResponse.status).toBe(204);
    expect(rootsBody.roots).toEqual([
      expect.objectContaining({
        id: populatedRootId,
        path: populatedCollectionPath
      })
    ]);
  });

  it("lets authenticated users cancel queued scan jobs", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const bookPath = join(collectionPath, "Volume 1");
    mkdirSync(bookPath, { recursive: true });
    writeFileSync(join(bookPath, "001.jpg"), "image-one");

    const jobQueue = createBookCafeJobQueue(1);
    const blockerStarted = createDeferred<void>();
    const releaseBlocker = createDeferred<void>();
    jobQueue.add("test-blocker", async () => {
      blockerStarted.resolve();
      await releaseBlocker.promise;
    });

    const app = createApp({ configPath, jobQueue });
    await initializeUser(app);
    const cookie = await signInUser(app);
    await blockerStarted.promise;

    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();
    const jobResponse = await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    const queuedJob = await jobResponse.json();
    const unauthorizedResponse = await app.request(
      `/api/jobs/${queuedJob.id}`,
      { method: "DELETE" }
    );
    const cancelResponse = await app.request(`/api/jobs/${queuedJob.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie }
    });
    const cancelledJob = await cancelResponse.json();
    const repeatedCancelResponse = await app.request(
      `/api/jobs/${queuedJob.id}`,
      {
        method: "DELETE",
        headers: { Cookie: cookie }
      }
    );
    const missingCancelResponse = await app.request("/api/jobs/missing-job", {
      method: "DELETE",
      headers: { Cookie: cookie }
    });

    releaseBlocker.resolve();
    await jobQueue.onIdle();

    const database = openBookCafeDatabase(resolveDataPaths(dir).databasePath);

    try {
      expect(rootResponse.status).toBe(201);
      expect(jobResponse.status).toBe(202);
      expect(queuedJob).toEqual(
        expect.objectContaining({ status: "queued", canCancel: true })
      );
      expect(unauthorizedResponse.status).toBe(401);
      expect(cancelResponse.status).toBe(200);
      expect(cancelledJob).toEqual(
        expect.objectContaining({
          id: queuedJob.id,
          status: "cancelled",
          canCancel: false
        })
      );
      expect(repeatedCancelResponse.status).toBe(409);
      expect(missingCancelResponse.status).toBe(404);
      expect(listBookSummaries(database)).toEqual([]);
      expect(listJobs(database)).toEqual([
        expect.objectContaining({
          id: queuedJob.id,
          status: "cancelled"
        })
      ]);
    } finally {
      closeDatabase(database);
    }
  });

  it("scans an image-folder collection root into persisted books", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const bookPath = join(collectionPath, "Volume 1");
    mkdirSync(bookPath, { recursive: true });
    writeFileSync(join(bookPath, "001.jpg"), "image-one");
    writeFileSync(join(bookPath, "002.jpg"), "image-two");

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();
    const jobResponse = await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    const queuedJob = await jobResponse.json();

    await jobQueue.onIdle();

    const jobsResponse = await app.request("/api/jobs", {
      headers: { Cookie: cookie }
    });
    const jobsBody = await jobsResponse.json();
    const completedJob = jobsBody.jobs.find(
      (job: { id: string }) => job.id === queuedJob.id
    );
    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const scannedBook = booksBody.books[0];
    const pageResponse = await app.request(
      `/api/books/${scannedBook.id}/pages/1/image`,
      {
        headers: { Cookie: cookie }
      }
    );
    const progressResponse = await app.request(
      `/api/books/${scannedBook.id}/progress`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ currentPage: 2 })
      }
    );
    const progressBody = await progressResponse.json();
    const detailResponse = await app.request(`/api/books/${scannedBook.id}`, {
      headers: { Cookie: cookie }
    });
    const detailBody = await detailResponse.json();

    expect(rootResponse.status).toBe(201);
    expect(jobResponse.status).toBe(202);
    expect(jobsResponse.status).toBe(200);
    expect(completedJob).toEqual(
      expect.objectContaining({
        status: "completed",
        payload: expect.objectContaining({
          collectionRootId: root.id,
          path: collectionPath,
          discoveredBooks: 1,
          missingBooks: 0
        })
      })
    );
    expect(booksBody.books).toEqual([
      expect.objectContaining({
        title: "Volume 1",
        format: "image-folder",
        pageCount: 2
      })
    ]);
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(await pageResponse.text()).toBe("image-one");
    expect(progressResponse.status).toBe(200);
    expect(progressBody.currentPage).toBe(2);
    expect(detailResponse.status).toBe(200);
    expect(detailBody.currentPage).toBe(2);
  });

  it("queues scan jobs for all configured collection roots", async () => {
    const { dir, configPath } = createTestConfig();
    const firstCollectionPath = join(dir, "collection-a");
    const secondCollectionPath = join(dir, "collection-b");
    const firstBookPath = join(firstCollectionPath, "Volume A");
    const secondBookPath = join(secondCollectionPath, "Volume B");
    mkdirSync(firstBookPath, { recursive: true });
    mkdirSync(secondBookPath, { recursive: true });
    writeFileSync(join(firstBookPath, "001.jpg"), "image-a");
    writeFileSync(join(secondBookPath, "001.jpg"), "image-b");

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: firstCollectionPath })
    });
    await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: secondCollectionPath })
    });

    const jobResponse = await app.request("/api/jobs/scan-all", {
      method: "POST",
      headers: { Cookie: cookie }
    });
    const jobBody = await jobResponse.json();

    await jobQueue.onIdle();

    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const titles = booksBody.books
      .map((book: { title: string }) => book.title)
      .sort();

    expect(jobResponse.status).toBe(202);
    expect(jobBody.jobs).toHaveLength(2);
    expect(
      jobBody.jobs.every(
        (job: { type: string; status: string }) =>
          job.type === "scan-collection-root" && job.status === "queued"
      )
    ).toBe(true);
    expect(titles).toEqual(["Volume A", "Volume B"]);
  });

  it("marks books missing when they disappear before a user scan", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const presentBookPath = join(collectionPath, "Volume Present");
    const removedBookPath = join(collectionPath, "Volume Removed");
    mkdirSync(presentBookPath, { recursive: true });
    mkdirSync(removedBookPath, { recursive: true });
    writeFileSync(join(presentBookPath, "001.jpg"), "image-one");
    writeFileSync(join(removedBookPath, "001.jpg"), "image-two");

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    rmSync(removedBookPath, { recursive: true, force: true });

    const secondJobResponse = await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    const secondJob = await secondJobResponse.json();
    await jobQueue.onIdle();

    const jobsResponse = await app.request("/api/jobs", {
      headers: { Cookie: cookie }
    });
    const jobsBody = await jobsResponse.json();
    const completedSecondJob = jobsBody.jobs.find(
      (job: { id: string }) => job.id === secondJob.id
    );
    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const booksByTitle = new Map(
      booksBody.books.map((book: { title: string; status: string }) => [
        book.title,
        book.status
      ])
    );
    const removedBook = booksBody.books.find(
      (book: { title: string }) => book.title === "Volume Removed"
    );

    if (!removedBook) {
      throw new Error("Removed book was not returned by the API.");
    }

    const removedPageResponse = await app.request(
      `/api/books/${removedBook.id}/pages/1/image`,
      {
        headers: { Cookie: cookie }
      }
    );
    const removedPageBody = await removedPageResponse.json();

    expect(booksResponse.status).toBe(200);
    expect(completedSecondJob).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          discoveredBooks: 1,
          missingBooks: 1
        })
      })
    );
    expect(booksByTitle.get("Volume Present")).toBe("ready");
    expect(booksByTitle.get("Volume Removed")).toBe("missing");
    expect(removedPageResponse.status).toBe(404);
    expect(removedPageBody).toEqual({
      message: "Page image is not readable."
    });
  });

  it("keeps reading progress when a later scan refreshes the same book", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const bookPath = join(collectionPath, "Progress Volume");
    mkdirSync(bookPath, { recursive: true });
    writeFileSync(join(bookPath, "001.jpg"), "image-one");
    writeFileSync(join(bookPath, "002.jpg"), "image-two");
    writeFileSync(join(bookPath, "003.jpg"), "image-three");

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const book = (await booksResponse.json()).books[0];

    await app.request(`/api/books/${book.id}/progress`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ currentPage: 3 })
    });

    writeFileSync(join(bookPath, "004.jpg"), "image-four");

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const detailResponse = await app.request(`/api/books/${book.id}`, {
      headers: { Cookie: cookie }
    });
    const detail = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detail).toEqual(
      expect.objectContaining({
        currentPage: 3,
        pageCount: 4
      })
    );
  });

  it("generates and serves thumbnails for readable image-folder books", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const bookPath = join(collectionPath, "Volume With Thumbnail");
    mkdirSync(bookPath, { recursive: true });
    await writeReadablePng(join(bookPath, "001.png"));
    await writeReadablePng(join(bookPath, "002.png"));

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const scannedBook = booksBody.books[0];
    const thumbnailResponse = await app.request(scannedBook.thumbnailUrl, {
      headers: { Cookie: cookie }
    });

    expect(booksResponse.status).toBe(200);
    expect(scannedBook).toEqual(
      expect.objectContaining({
        title: "Volume With Thumbnail",
        thumbnailUrl: `/api/books/${scannedBook.id}/thumbnail`
      })
    );
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/webp");
    expect((await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(
      0
    );
  });

  it("skips thumbnail generation when thumbnail storage is disabled", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const bookPath = join(collectionPath, "Volume Without Thumbnail");
    mkdirSync(bookPath, { recursive: true });
    await writeReadablePng(join(bookPath, "001.png"));

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    await app.request("/api/settings/thumbnails", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ enabled: false })
    });
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const scannedBook = booksBody.books[0];

    expect(booksResponse.status).toBe(200);
    expect(scannedBook).toEqual(
      expect.objectContaining({
        title: "Volume Without Thumbnail",
        thumbnailUrl: null
      })
    );
  });

  it("keeps saved thumbnails when later scans run with thumbnail storage disabled", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const bookPath = join(collectionPath, "Volume With Existing Thumbnail");
    mkdirSync(bookPath, { recursive: true });
    await writeReadablePng(join(bookPath, "001.png"));

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const initialBooksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const initialBook = (await initialBooksResponse.json()).books[0];

    await app.request("/api/settings/thumbnails", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ enabled: false })
    });
    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const rescannedBooksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const rescannedBook = (await rescannedBooksResponse.json()).books[0];
    const thumbnailResponse = await app.request(rescannedBook.thumbnailUrl, {
      headers: { Cookie: cookie }
    });

    expect(initialBook.thumbnailUrl).toBe(
      `/api/books/${initialBook.id}/thumbnail`
    );
    expect(rescannedBook).toEqual(
      expect.objectContaining({
        id: initialBook.id,
        title: "Volume With Existing Thumbnail",
        thumbnailUrl: initialBook.thumbnailUrl
      })
    );
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/webp");
  });

  it("scans cbz archives and serves archive-entry pages with thumbnails", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const archivePath = join(collectionPath, "Volume Archive.cbz");
    mkdirSync(collectionPath, { recursive: true });

    const pageOne = await createReadablePngData();
    const pageTwo = await createReadablePngData();
    writeFileSync(
      archivePath,
      zipSync({
        "002.png": pageTwo,
        "001.png": pageOne,
        "notes.txt": new Uint8Array([99])
      })
    );

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const scannedBook = booksBody.books[0];
    const pageResponse = await app.request(
      `/api/books/${scannedBook.id}/pages/1/image`,
      {
        headers: { Cookie: cookie }
      }
    );
    const thumbnailResponse = await app.request(scannedBook.thumbnailUrl, {
      headers: { Cookie: cookie }
    });

    expect(booksResponse.status).toBe(200);
    expect(scannedBook).toEqual(
      expect.objectContaining({
        title: "Volume Archive",
        format: "cbz",
        pageCount: 2,
        thumbnailUrl: `/api/books/${scannedBook.id}/thumbnail`
      })
    );
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toBe("image/png");
    expect((await pageResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/webp");
    expect((await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(
      0
    );
  });

  it("scans 7z archives and serves packed-archive-entry pages with thumbnails", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const archivePath = join(collectionPath, "Volume Seven.7z");
    mkdirSync(collectionPath, { recursive: true });
    writeFileSync(archivePath, createTestSevenZipArchive());

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const scannedBook = booksBody.books[0];
    const pageResponse = await app.request(
      `/api/books/${scannedBook.id}/pages/1/image`,
      {
        headers: { Cookie: cookie }
      }
    );
    const thumbnailResponse = await app.request(scannedBook.thumbnailUrl, {
      headers: { Cookie: cookie }
    });

    expect(booksResponse.status).toBe(200);
    expect(scannedBook).toEqual(
      expect.objectContaining({
        title: "Volume Seven",
        format: "seven-zip",
        pageCount: 2,
        thumbnailUrl: `/api/books/${scannedBook.id}/thumbnail`
      })
    );
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toBe("image/png");
    expect((await pageResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/webp");
    expect((await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(
      0
    );
  });

  it("scans PDFs and serves rendered PDF pages with thumbnails", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const pdfPath = join(collectionPath, "Volume PDF.pdf");
    mkdirSync(collectionPath, { recursive: true });
    writeFileSync(pdfPath, createTestPdf(), "binary");

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const scannedBook = booksBody.books[0];
    const pageResponse = await app.request(
      `/api/books/${scannedBook.id}/pages/1/image`,
      {
        headers: { Cookie: cookie }
      }
    );
    const thumbnailResponse = await app.request(scannedBook.thumbnailUrl, {
      headers: { Cookie: cookie }
    });

    expect(booksResponse.status).toBe(200);
    expect(scannedBook).toEqual(
      expect.objectContaining({
        title: "Volume PDF",
        format: "pdf",
        pageCount: 1,
        thumbnailUrl: `/api/books/${scannedBook.id}/thumbnail`
      })
    );
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toBe("image/png");
    expect((await pageResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/webp");
    expect((await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(
      0
    );
  });

  it("scans EPUBs and serves generated EPUB pages with thumbnails", async () => {
    const { dir, configPath } = createTestConfig();
    const collectionPath = join(dir, "collection");
    const epubPath = join(collectionPath, "Volume EPUB.epub");
    mkdirSync(collectionPath, { recursive: true });
    writeFileSync(epubPath, createTestEpub());

    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ configPath, jobQueue });

    await initializeUser(app);

    const cookie = await signInUser(app);
    const rootResponse = await app.request("/api/collection-roots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path: collectionPath })
    });
    const root = await rootResponse.json();

    await app.request("/api/jobs/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ collectionRootId: root.id })
    });
    await jobQueue.onIdle();

    const booksResponse = await app.request("/api/books", {
      headers: { Cookie: cookie }
    });
    const booksBody = await booksResponse.json();
    const scannedBook = booksBody.books[0];
    const pageResponse = await app.request(
      `/api/books/${scannedBook.id}/pages/1/image`,
      {
        headers: { Cookie: cookie }
      }
    );
    const thumbnailResponse = await app.request(scannedBook.thumbnailUrl, {
      headers: { Cookie: cookie }
    });

    expect(booksResponse.status).toBe(200);
    expect(scannedBook).toEqual(
      expect.objectContaining({
        title: "Test EPUB",
        authors: ["Test Author"],
        format: "epub",
        pageCount: 1,
        thumbnailUrl: `/api/books/${scannedBook.id}/thumbnail`
      })
    );
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toBe("image/png");
    expect((await pageResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/webp");
    expect((await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(
      0
    );
  });
});

/**
 * Creates an isolated BookCafe config for a test case.
 */
const createTestConfig = (options: { port?: number } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "bookcafe-server-"));
  tempDirs.push(dir);
  const configPath = join(dir, "config.json");
  const port = options.port ?? 4510;

  saveConfig(
    {
      dataDir: dir,
      host: "127.0.0.1",
      port,
      thumbnails: { enabled: true },
      setupComplete: false
    },
    configPath
  );

  return { dir, configPath, port };
};

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

/** Creates a manually resolved promise for deterministic queue tests. */
const createDeferred = <Value>(): Deferred<Value> => {
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
};

/**
 * Creates the initial Better Auth user through the public setup API.
 */
const initializeUser = async (
  app: ReturnType<typeof createApp>
): Promise<void> => {
  const response = await app.request("/api/setup/initial-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...testUser,
      port: 4510
    })
  });

  expect(response.status).toBe(201);
};

/**
 * Signs in through the Better Auth username endpoint and returns a Cookie header.
 */
const signInUser = async (
  app: ReturnType<typeof createApp>
): Promise<string> => {
  const response = await app.request("/api/auth/sign-in/username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testUser)
  });
  const cookie = getCookieHeader(response);

  expect(response.status).toBe(200);
  expect(cookie).not.toBe("");

  return cookie;
};

/**
 * Extracts Set-Cookie values as a single Cookie request header.
 */
const getCookieHeader = (response: Response): string => {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() ?? [];
  const rawCookies =
    setCookies.length > 0
      ? setCookies
      : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie") ?? ""]
        : [];

  return rawCookies
    .map((cookie) => cookie.split(";")[0])
    .filter((cookie) => cookie.length > 0)
    .join("; ");
};

/**
 * Writes a small valid PNG that image decoders can resize in tests.
 */
const writeReadablePng = async (filePath: string): Promise<void> => {
  await createReadablePng().png().toFile(filePath);
};

/**
 * Creates a small valid PNG buffer that image decoders can resize in tests.
 */
const createReadablePngData = async (): Promise<Uint8Array> => {
  const buffer = await createReadablePng().png().toBuffer();
  return Uint8Array.from(buffer);
};

/**
 * Creates a sharp image builder for a tiny readable PNG.
 */
const createReadablePng = () =>
  sharp({
    create: {
      width: 4,
      height: 6,
      channels: 3,
      background: { r: 240, g: 64, b: 96 }
    }
  });

/**
 * Creates a tiny valid PDF with one colored page.
 */
const createTestPdf = (): string => {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    [
      "3 0 obj\n",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 260] ",
      "/Contents 4 0 R /Resources << >> >>\n",
      "endobj\n"
    ].join(""),
    [
      "4 0 obj\n",
      "<< /Length 28 >>\n",
      "stream\n",
      "0.9 0.2 0.3 rg\n",
      "0 0 200 260 re\n",
      "f\n",
      "endstream\n",
      "endobj\n"
    ].join("")
  ];
  let content = "%PDF-1.4\n";
  const offsets: number[] = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(content, "binary"));
    content += object;
  }

  const xrefOffset = Buffer.byteLength(content, "binary");
  content += `xref\n0 ${objects.length + 1}\n`;
  content += "0000000000 65535 f \n";

  for (const offset of offsets.slice(1)) {
    content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  content += [
    "trailer\n",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    "startxref\n",
    `${xrefOffset}\n`,
    "%%EOF\n"
  ].join("");

  return content;
};

/**
 * Creates a minimal EPUB with one XHTML spine item.
 */
const createTestEpub = (): Uint8Array =>
  zipSync({
    mimetype: new TextEncoder().encode("application/epub+zip"),
    "META-INF/container.xml": new TextEncoder().encode(
      [
        '<?xml version="1.0"?>',
        '<container version="1.0" ',
        'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
        "<rootfiles>",
        '<rootfile full-path="OEBPS/content.opf" ',
        'media-type="application/oebps-package+xml"/>',
        "</rootfiles>",
        "</container>"
      ].join("")
    ),
    "OEBPS/content.opf": new TextEncoder().encode(
      [
        '<?xml version="1.0"?>',
        '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">',
        "<metadata>",
        '<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">',
        "Test EPUB",
        "</dc:title>",
        '<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">',
        "Test Author",
        "</dc:creator>",
        "</metadata>",
        "<manifest>",
        '<item id="chapter1" href="chapter1.xhtml" ',
        'media-type="application/xhtml+xml"/>',
        "</manifest>",
        "<spine>",
        '<itemref idref="chapter1"/>',
        "</spine>",
        "</package>"
      ].join("")
    ),
    "OEBPS/chapter1.xhtml": new TextEncoder().encode(
      [
        '<?xml version="1.0"?>',
        '<html xmlns="http://www.w3.org/1999/xhtml">',
        "<head><title>Chapter 1</title></head>",
        "<body>",
        "<h1>Chapter One</h1>",
        "<p>Hello from EPUB content.</p>",
        "</body>",
        "</html>"
      ].join("")
    )
  });

/**
 * Creates a real 7z archive containing two PNG pages and one ignored text file.
 */
const createTestSevenZipArchive = (): Uint8Array =>
  Uint8Array.from(
    Buffer.from(
      [
        "N3q8ryccAATLcz7q2QAAAAAAAAAiAAAAAAAAAOnnYCjgAJIATV0ARJQFxHon",
        "9vfuiY5QkIizqtVQIJYzd/penA8ly9BiL+x00+opEvTeaycPPvyWxLnJq1",
        "S7Vm51kpHgB1hngh1o0fZTziMC5oXrtLnilwAAAACBMweuD9MB9D1AwJ",
        "DS/31pTY8XLDFjednXkYg/UHJw/lEUPtqcNHi2CAb5Smj0UYqPm/h2V",
        "bt9EL46al3Six0j+9IaiRgW6Mq91hnzYKLDTUXlHUiRcL5yR8/KPSF+",
        "lMtUnHxP22+zeKDLXZQ1n8kASjaOR0uAUVsNgUxlDWpMAAAAFwZVAQm",
        "AhAAHCwEAASMDAQEFXQAQAAAMgN4KAbHV3pcAAA=="
      ].join(""),
      "base64"
    )
  );
