import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveStatePaths, saveConfig } from "@bookcafe/config";
import {
  closeDatabase,
  createJob,
  createScanFailure,
  findLibrary,
  listLibraries,
  openBookCafeDatabase,
  persistScannedBook
} from "@bookcafe/db";
import { afterEach, describe, expect, it } from "vitest";

import { createApp as createProductionApp } from "./library-app.js";
import { createBookCafeJobQueue } from "./job-queue.js";

const tempDirs: string[] = [];
const testUser = {
  username: "admin",
  password: "password123"
};

/**
 * Creates an app whose initial setup request is always treated as loopback.
 */
const createApp = (
  options: Parameters<typeof createProductionApp>[0]
): ReturnType<typeof createProductionApp> =>
  createProductionApp({
    ...options,
    readRemoteAddress: () => "127.0.0.1"
  });

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("single database Hono app", () => {
  it("derives setup state from users and accepts only account credentials", async () => {
    const fixture = createFixture();
    const app = createApp(fixture);

    const statusBefore = await app.request("/api/setup/status");
    const setup = await app.request("/api/setup/initial-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...testUser,
        dataDir: "/ignored",
        collectionRoots: ["/ignored"],
        host: "0.0.0.0"
      })
    });
    const statusAfter = await app.request("/api/setup/status");
    const database = openBookCafeDatabase(
      resolveStatePaths(fixture.stateDir).databasePath
    );

    try {
      expect(statusBefore.status).toBe(200);
      expect(await statusBefore.json()).toEqual({ setupComplete: false });
      expect(setup.status).toBe(201);
      expect(await setup.json()).toEqual({ setupComplete: true });
      expect(statusAfter.status).toBe(200);
      expect(await statusAfter.json()).toEqual({ setupComplete: true });
      expect(
        database.sqlite.prepare('SELECT COUNT(*) AS value FROM "user"').get()
      ).toEqual({ value: 1 });
      expect(listLibraries(database)).toEqual([]);
    } finally {
      closeDatabase(database);
    }
  });

  it("requires authentication and returns an empty library instead of samples", async () => {
    const fixture = createFixture();
    const app = createApp(fixture);
    await initializeUser(app);

    const unauthorized = await app.request("/api/libraries");
    const cookie = await signInUser(app);
    const rootPath = join(fixture.directory, "books");
    mkdirSync(rootPath);
    const created = await createLibrary(app, cookie, {
      name: "Books",
      rootPath
    });
    const books = await app.request(`/api/libraries/${created.id}/books`, {
      headers: { Cookie: cookie }
    });

    expect(unauthorized.status).toBe(401);
    expect(books.status).toBe(200);
    expect(await books.json()).toEqual({ books: [] });
  });

  it("returns the stable API error shape for invalid JSON input", async () => {
    const fixture = createFixture();
    const app = createApp(fixture);
    await initializeUser(app);
    const cookie = await signInUser(app);
    const response = await app.request("/api/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "" })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_INPUT",
      message: "Request body is invalid."
    });
  });

  it("returns bounded path-safe scan failure pages for a library job", async () => {
    const fixture = createFixture();
    const app = createApp(fixture);
    await initializeUser(app);
    const cookie = await signInUser(app);
    const rootPath = join(fixture.directory, "books");
    mkdirSync(rootPath);
    const library = await createLibrary(app, cookie, {
      name: "Books",
      rootPath
    });
    const database = openBookCafeDatabase(
      resolveStatePaths(fixture.stateDir).databasePath
    );
    const job = createJob(database, {
      libraryId: library.id,
      type: "scan-library",
      payload: { failed: 2 }
    });
    createScanFailure(database, {
      jobId: job.id,
      kind: "book",
      relativePath: "Broken.pdf",
      format: "pdf",
      code: "PDF_INVALID_HEADER"
    });
    createScanFailure(database, {
      jobId: job.id,
      kind: "subtree",
      relativePath: "Unreadable",
      format: "unknown",
      code: "DIRECTORY_UNREADABLE"
    });
    closeDatabase(database);

    const firstPage = await app.request(
      `/api/libraries/${library.id}/jobs/${job.id}/failures?offset=0&limit=1`,
      { headers: { Cookie: cookie } }
    );
    const invalidPage = await app.request(
      `/api/libraries/${library.id}/jobs/${job.id}/failures?limit=101`,
      { headers: { Cookie: cookie } }
    );

    expect(firstPage.status).toBe(200);
    expect(await firstPage.json()).toEqual({
      failures: [
        expect.objectContaining({
          jobId: job.id,
          kind: "book",
          relativePath: "Broken.pdf",
          format: "pdf",
          code: "PDF_INVALID_HEADER"
        })
      ],
      total: 2,
      offset: 0,
      limit: 1,
      hasMore: true
    });
    expect(invalidPage.status).toBe(400);
    expect(await invalidPage.json()).toEqual({
      code: "INVALID_INPUT",
      message: "Scan failure pagination is invalid."
    });
  });

  it("validates roots and keeps book lookups inside the URL library", async () => {
    const fixture = createFixture();
    const app = createApp(fixture);
    await initializeUser(app);
    const cookie = await signInUser(app);
    const firstRoot = join(fixture.directory, "first");
    const secondRoot = join(fixture.directory, "second");
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    const first = await createLibrary(app, cookie, {
      name: "First",
      rootPath: firstRoot
    });
    const second = await createLibrary(app, cookie, {
      name: "Second",
      rootPath: secondRoot
    });
    const duplicate = await app.request("/api/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "first", rootPath: secondRoot })
    });
    const database = openBookCafeDatabase(
      resolveStatePaths(fixture.stateDir).databasePath
    );
    const book = persistScannedBook(database, {
      libraryId: first.id,
      relativePath: "Volume 1",
      title: "Volume 1",
      format: "image-folder",
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          sourceType: "file",
          relativePath: "Volume 1/001.jpg"
        }
      ]
    });
    closeDatabase(database);

    const firstDetail = await app.request(
      `/api/libraries/${first.id}/books/${book.id}`,
      { headers: { Cookie: cookie } }
    );
    const leakedDetail = await app.request(
      `/api/libraries/${second.id}/books/${book.id}`,
      { headers: { Cookie: cookie } }
    );

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      code: "LIBRARY_NAME_CONFLICT"
    });
    expect(firstDetail.status).toBe(200);
    expect(await firstDetail.json()).not.toHaveProperty("sourcePath");
    expect(leakedDetail.status).toBe(404);
    expect(await leakedDetail.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("stores user progress and supports archive and restore without delete", async () => {
    const fixture = createFixture();
    const app = createApp(fixture);
    await initializeUser(app);
    const cookie = await signInUser(app);
    const rootPath = join(fixture.directory, "books");
    mkdirSync(rootPath);
    const library = await createLibrary(app, cookie, {
      name: "Books",
      rootPath
    });
    const database = openBookCafeDatabase(
      resolveStatePaths(fixture.stateDir).databasePath
    );
    const book = persistScannedBook(database, {
      libraryId: library.id,
      relativePath: "Volume 1",
      title: "Volume 1",
      format: "image-folder",
      pageCount: 2,
      pages: [
        {
          pageNumber: 1,
          sourceType: "file",
          relativePath: "Volume 1/001.jpg"
        },
        {
          pageNumber: 2,
          sourceType: "file",
          relativePath: "Volume 1/002.jpg"
        }
      ]
    });
    closeDatabase(database);

    const progress = await app.request(
      `/api/libraries/${library.id}/books/${book.id}/progress`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ currentPage: 2 })
      }
    );
    const archived = await app.request(
      `/api/libraries/${library.id}/books/${book.id}/archive`,
      { method: "POST", headers: { Cookie: cookie } }
    );
    const normalList = await app.request(`/api/libraries/${library.id}/books`, {
      headers: { Cookie: cookie }
    });
    const archiveList = await app.request(
      `/api/libraries/${library.id}/books/archived`,
      { headers: { Cookie: cookie } }
    );
    const restored = await app.request(
      `/api/libraries/${library.id}/books/${book.id}/restore`,
      { method: "POST", headers: { Cookie: cookie } }
    );

    expect(progress.status).toBe(200);
    expect(await progress.json()).toMatchObject({ currentPage: 2 });
    expect(archived.status).toBe(200);
    expect(await normalList.json()).toEqual({ books: [] });
    expect(await archiveList.json()).toEqual({
      books: [expect.objectContaining({ id: book.id, currentPage: 2 })]
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      id: book.id,
      archivedAt: null
    });
  });

  it.skipIf(process.platform === "win32")(
    "does not follow a page symlink outside its library",
    async () => {
      const fixture = createFixture();
      const app = createApp(fixture);
      await initializeUser(app);
      const cookie = await signInUser(app);
      const rootPath = join(fixture.directory, "library");
      const outsidePath = join(fixture.directory, "outside.png");
      const linkedPath = join(rootPath, "linked.png");
      mkdirSync(rootPath);
      writeFileSync(outsidePath, "outside-library-data");
      symlinkSync(outsidePath, linkedPath);
      const library = await createLibrary(app, cookie, {
        name: "Library",
        rootPath
      });
      const database = openBookCafeDatabase(
        resolveStatePaths(fixture.stateDir).databasePath
      );
      let bookId = "";

      try {
        bookId = persistScannedBook(database, {
          libraryId: library.id,
          relativePath: ".",
          title: "Linked",
          format: "image-folder",
          pageCount: 1,
          pages: [
            {
              pageNumber: 1,
              sourceType: "file",
              relativePath: "linked.png"
            }
          ]
        }).id;
      } finally {
        closeDatabase(database);
      }

      const response = await app.request(
        `/api/libraries/${library.id}/books/${bookId}/pages/1/image`,
        { headers: { Cookie: cookie } }
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        code: "NOT_FOUND",
        message: "Page not found."
      });
    }
  );

  it("scans by library, blocks active mutations, and deletes only central data", async () => {
    const fixture = createFixture();
    const jobQueue = createBookCafeJobQueue();
    const app = createApp({ ...fixture, jobQueue });
    await initializeUser(app);
    const cookie = await signInUser(app);
    const rootPath = join(fixture.directory, "books");
    const bookPath = join(rootPath, "Volume 1");
    mkdirSync(bookPath, { recursive: true });
    writeFileSync(join(bookPath, "001.jpg"), "page");
    const library = await createLibrary(app, cookie, {
      name: "Books",
      rootPath
    });
    const databasePath = resolveStatePaths(fixture.stateDir).databasePath;
    const database = openBookCafeDatabase(databasePath);
    const queued = createJob(database, {
      libraryId: library.id,
      type: "scan-library",
      payload: {}
    });
    closeDatabase(database);

    const busyPatch = await app.request(`/api/libraries/${library.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Renamed" })
    });
    const busyDelete = await app.request(`/api/libraries/${library.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie }
    });

    const cancellable = await app.request(
      `/api/libraries/${library.id}/jobs/${queued.id}`,
      { method: "DELETE", headers: { Cookie: cookie } }
    );
    const scan = await app.request(`/api/libraries/${library.id}/jobs/scan`, {
      method: "POST",
      headers: { Cookie: cookie }
    });
    await jobQueue.onIdle();
    const books = await app.request(`/api/libraries/${library.id}/books`, {
      headers: { Cookie: cookie }
    });
    const deleted = await app.request(`/api/libraries/${library.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie }
    });
    const verified = openBookCafeDatabase(databasePath);

    try {
      expect(busyPatch.status).toBe(409);
      expect(busyDelete.status).toBe(409);
      expect(cancellable.status).toBe(200);
      expect(scan.status).toBe(201);
      expect(await books.json()).toEqual({
        books: [
          expect.objectContaining({
            relativePath: "Volume 1",
            pageCount: 1
          })
        ]
      });
      expect(deleted.status).toBe(204);
      expect(findLibrary(verified, library.id)).toBeNull();
      expect(existsSync(join(bookPath, "001.jpg"))).toBe(true);
    } finally {
      closeDatabase(verified);
    }
  });
});

/**
 * Creates isolated config and StateDir paths.
 */
const createFixture = (): {
  configPath: string;
  directory: string;
  stateDir: string;
} => {
  const directory = mkdtempSync(join(tmpdir(), "bookcafe-app-"));
  tempDirs.push(directory);
  const stateDir = join(directory, "state");
  const configPath = join(stateDir, "config.json");

  saveConfig(
    {
      host: "127.0.0.1",
      port: 4510,
      thumbnails: { enabled: false }
    },
    configPath
  );

  return { configPath, directory, stateDir };
};

/**
 * Creates the first Better Auth user.
 */
const initializeUser = async (
  app: ReturnType<typeof createApp>
): Promise<void> => {
  const response = await app.request("/api/setup/initial-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testUser)
  });

  expect(response.status).toBe(201);
};

/**
 * Signs in with the username plugin and returns one Cookie header.
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
 * Creates a library through the authenticated API.
 */
const createLibrary = async (
  app: ReturnType<typeof createApp>,
  cookie: string,
  body: { name: string; rootPath: string }
): Promise<{ id: string; name: string; rootPath: string }> => {
  const response = await app.request("/api/libraries", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body)
  });

  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    name: string;
    rootPath: string;
  };
};

/**
 * Extracts Set-Cookie values as one Cookie request header.
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
    .filter(Boolean)
    .join("; ");
};
