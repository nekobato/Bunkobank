/**
 * Authenticated API helpers for the Bunkobank frontend.
 *
 * @module
 */

import type {
  BackgroundJobListResponse,
  BackgroundJobResponse,
  BookDetailResponse,
  BookListQuery,
  BookListResponse,
  CollectionBookCreateRequest,
  CollectionBookOrderRequest,
  CollectionCreateRequest,
  CollectionDetailResponse,
  CollectionListResponse,
  CollectionResponse,
  CollectionUpdateRequest,
  InitialSetupRequest,
  LibraryCreateRequest,
  LibraryImportResponse,
  LibraryListResponse,
  LibraryPreferenceResponse,
  LibraryResponse,
  LibraryUnlockRequest,
  LibraryUpdateRequest,
  NetworkSettingsResponse,
  ScanFailureListQuery,
  ScanFailureListResponse,
  SetupStatusResponse,
  ThumbnailSettingsResponse,
  UpdateBookMetadataRequest,
  UpdateBookProgressRequest,
  UpdateLibraryPreferenceRequest,
  UpdateNetworkSettingsRequest,
  UpdateThumbnailSettingsRequest
} from "@bunkobank/contracts";

import {
  createLibraryApiPath,
  resolveApiAssetUrl
} from "../utils/libraryApiPaths";

/**
 * Creates small API helpers scoped explicitly to a selected library.
 */
export const useBookApi = () => {
  const apiBase = useApiBase();
  const requestOptions = { credentials: "include" as const };

  /** Resolves the thumbnail URL returned by the API for split-origin dev mode. */
  const resolveBookAssets = <Book extends { thumbnailUrl: string | null }>(
    book: Book
  ): Book => ({
    ...book,
    thumbnailUrl: book.thumbnailUrl
      ? resolveApiAssetUrl(apiBase, book.thumbnailUrl)
      : null
  });

  /** Fetches all configured libraries. */
  const listLibraries = () =>
    $fetch<LibraryListResponse>(`${apiBase}/libraries`, requestOptions);

  /** Registers one named library and its server-side directory. */
  const createLibrary = (body: LibraryCreateRequest) =>
    $fetch<LibraryResponse>(`${apiBase}/libraries`, {
      ...requestOptions,
      method: "POST",
      body
    });

  /** Updates a library name or target directory. */
  const updateLibrary = (libraryId: string, body: LibraryUpdateRequest) =>
    $fetch<LibraryResponse>(createLibraryApiPath(apiBase, libraryId), {
      ...requestOptions,
      method: "PATCH",
      body
    });

  /** Deletes Bunkobank records for one library without touching source files. */
  const deleteLibrary = (libraryId: string) =>
    $fetch<void>(createLibraryApiPath(apiBase, libraryId), {
      ...requestOptions,
      method: "DELETE"
    });

  /** Unlocks one encrypted library for the current server process. */
  const unlockLibrary = (libraryId: string, body: LibraryUnlockRequest) =>
    $fetch<LibraryResponse>(
      createLibraryApiPath(apiBase, libraryId, ["unlock"]),
      {
        ...requestOptions,
        method: "POST",
        body
      }
    );

  /** Clears one encrypted library's in-memory encryption key. */
  const lockLibrary = (libraryId: string) =>
    $fetch<LibraryResponse>(
      createLibraryApiPath(apiBase, libraryId, ["lock"]),
      {
        ...requestOptions,
        method: "POST"
      }
    );

  /** Uploads and imports one supported file into an unlocked encrypted library. */
  const importLibraryBook = (libraryId: string, file: File) =>
    $fetch<LibraryImportResponse>(
      createLibraryApiPath(apiBase, libraryId, ["books", "import"]),
      {
        ...requestOptions,
        method: "POST",
        query: { filename: file.name },
        body: file
      }
    );

  /** Fetches the current user's selected-library preference. */
  const getLibraryPreference = () =>
    $fetch<LibraryPreferenceResponse>(
      `${apiBase}/users/me/library-preference`,
      requestOptions
    );

  /** Persists the current user's selected library. */
  const updateLibraryPreference = (body: UpdateLibraryPreferenceRequest) =>
    $fetch<LibraryPreferenceResponse>(
      `${apiBase}/users/me/library-preference`,
      {
        ...requestOptions,
        method: "PATCH",
        body
      }
    );

  /** Fetches normal or archived books in one library. */
  const fetchBookList = async (
    libraryId: string,
    path: readonly string[],
    query: BookListQuery = {}
  ): Promise<BookListResponse> => {
    const response = await $fetch<BookListResponse>(
      createLibraryApiPath(apiBase, libraryId, path),
      {
        ...requestOptions,
        query: {
          q: query.q || undefined,
          readingStatus: query.readingStatus || undefined,
          bookStatus: query.bookStatus || undefined,
          sort: query.sort,
          order: query.order,
          offset: query.offset,
          limit: query.limit
        }
      }
    );

    return {
      ...response,
      books: response.books.map(resolveBookAssets)
    };
  };

  /** Fetches the visible books for one library. */
  const listBooks = (libraryId: string, query: BookListQuery = {}) =>
    fetchBookList(libraryId, ["books"], query);

  /** Fetches archived books for one library. */
  const listArchivedBooks = (libraryId: string, query: BookListQuery = {}) =>
    fetchBookList(libraryId, ["books", "archived"], query);

  /** Fetches one book by its library and book identifiers. */
  const getBook = async (
    libraryId: string,
    bookId: string
  ): Promise<BookDetailResponse> =>
    resolveBookAssets(
      await $fetch<BookDetailResponse>(
        createLibraryApiPath(apiBase, libraryId, ["books", bookId]),
        requestOptions
      )
    );

  /** Updates one book's persisted reading position. */
  const updateBookProgress = async (
    libraryId: string,
    bookId: string,
    body: UpdateBookProgressRequest,
    options: { keepalive?: boolean } = {}
  ): Promise<BookDetailResponse> =>
    resolveBookAssets(
      await $fetch<BookDetailResponse>(
        createLibraryApiPath(apiBase, libraryId, ["books", bookId, "progress"]),
        {
          ...requestOptions,
          method: "PATCH",
          priority: "low",
          keepalive: options.keepalive,
          body
        }
      )
    );

  /** Updates user-editable metadata for one book. */
  const updateBookMetadata = async (
    libraryId: string,
    bookId: string,
    body: UpdateBookMetadataRequest
  ): Promise<BookDetailResponse> =>
    resolveBookAssets(
      await $fetch<BookDetailResponse>(
        createLibraryApiPath(apiBase, libraryId, ["books", bookId, "metadata"]),
        {
          ...requestOptions,
          method: "PATCH",
          body
        }
      )
    );

  /** Archives one book while retaining its metadata and progress. */
  const archiveBook = async (
    libraryId: string,
    bookId: string
  ): Promise<BookDetailResponse> =>
    resolveBookAssets(
      await $fetch<BookDetailResponse>(
        createLibraryApiPath(apiBase, libraryId, ["books", bookId, "archive"]),
        {
          ...requestOptions,
          method: "POST"
        }
      )
    );

  /** Restores one archived book to the normal library. */
  const restoreBook = async (
    libraryId: string,
    bookId: string
  ): Promise<BookDetailResponse> =>
    resolveBookAssets(
      await $fetch<BookDetailResponse>(
        createLibraryApiPath(apiBase, libraryId, ["books", bookId, "restore"]),
        {
          ...requestOptions,
          method: "POST"
        }
      )
    );

  /** Fetches the current user's collections inside one library. */
  const listCollections = (libraryId: string) =>
    $fetch<CollectionListResponse>(
      createLibraryApiPath(apiBase, libraryId, ["collections"]),
      requestOptions
    );

  /** Creates one user-owned collection inside the selected library. */
  const createCollection = (libraryId: string, body: CollectionCreateRequest) =>
    $fetch<CollectionResponse>(
      createLibraryApiPath(apiBase, libraryId, ["collections"]),
      {
        ...requestOptions,
        method: "POST",
        body
      }
    );

  /** Fetches one collection and its manually ordered visible books. */
  const getCollection = async (
    libraryId: string,
    collectionId: string
  ): Promise<CollectionDetailResponse> => {
    const response = await $fetch<CollectionDetailResponse>(
      createLibraryApiPath(apiBase, libraryId, ["collections", collectionId]),
      requestOptions
    );

    return {
      ...response,
      books: response.books.map(resolveBookAssets)
    };
  };

  /** Renames one user-owned collection. */
  const updateCollection = (
    libraryId: string,
    collectionId: string,
    body: CollectionUpdateRequest
  ) =>
    $fetch<CollectionResponse>(
      createLibraryApiPath(apiBase, libraryId, ["collections", collectionId]),
      {
        ...requestOptions,
        method: "PATCH",
        body
      }
    );

  /** Deletes one collection without changing source books. */
  const deleteCollection = (libraryId: string, collectionId: string) =>
    $fetch<void>(
      createLibraryApiPath(apiBase, libraryId, ["collections", collectionId]),
      {
        ...requestOptions,
        method: "DELETE"
      }
    );

  /** Adds one same-library book at the end of a collection. */
  const addCollectionBook = async (
    libraryId: string,
    collectionId: string,
    body: CollectionBookCreateRequest
  ): Promise<CollectionDetailResponse> => {
    const response = await $fetch<CollectionDetailResponse>(
      createLibraryApiPath(apiBase, libraryId, [
        "collections",
        collectionId,
        "books"
      ]),
      {
        ...requestOptions,
        method: "POST",
        body
      }
    );

    return {
      ...response,
      books: response.books.map(resolveBookAssets)
    };
  };

  /** Removes one book from a collection without changing the source book. */
  const removeCollectionBook = (
    libraryId: string,
    collectionId: string,
    bookId: string
  ) =>
    $fetch<void>(
      createLibraryApiPath(apiBase, libraryId, [
        "collections",
        collectionId,
        "books",
        bookId
      ]),
      {
        ...requestOptions,
        method: "DELETE"
      }
    );

  /** Persists the full visible manual order for one collection. */
  const reorderCollectionBooks = async (
    libraryId: string,
    collectionId: string,
    body: CollectionBookOrderRequest
  ): Promise<CollectionDetailResponse> => {
    const response = await $fetch<CollectionDetailResponse>(
      createLibraryApiPath(apiBase, libraryId, [
        "collections",
        collectionId,
        "books",
        "order"
      ]),
      {
        ...requestOptions,
        method: "PATCH",
        body
      }
    );

    return {
      ...response,
      books: response.books.map(resolveBookAssets)
    };
  };

  /** Builds an authenticated page-image URL for the reader. */
  const getPageImageUrl = (
    libraryId: string,
    bookId: string,
    pageNumber: number
  ): string =>
    createLibraryApiPath(apiBase, libraryId, [
      "books",
      bookId,
      "pages",
      String(pageNumber),
      "image"
    ]);

  /** Fetches current setup status. */
  const getSetupStatus = () =>
    $fetch<SetupStatusResponse>(`${apiBase}/setup/status`, requestOptions);

  /** Creates the single shared initial user. */
  const createInitialSetup = (body: InitialSetupRequest) =>
    $fetch<SetupStatusResponse>(`${apiBase}/setup/initial-user`, {
      ...requestOptions,
      method: "POST",
      body
    });

  /** Fetches persisted server network settings. */
  const getNetworkSettings = () =>
    $fetch<NetworkSettingsResponse>(
      `${apiBase}/settings/network`,
      requestOptions
    );

  /** Updates persisted server network settings. */
  const updateNetworkSettings = (body: UpdateNetworkSettingsRequest) =>
    $fetch<NetworkSettingsResponse>(`${apiBase}/settings/network`, {
      ...requestOptions,
      method: "PATCH",
      body
    });

  /** Fetches persisted thumbnail settings. */
  const getThumbnailSettings = () =>
    $fetch<ThumbnailSettingsResponse>(
      `${apiBase}/settings/thumbnails`,
      requestOptions
    );

  /** Updates persisted thumbnail settings. */
  const updateThumbnailSettings = (body: UpdateThumbnailSettingsRequest) =>
    $fetch<ThumbnailSettingsResponse>(`${apiBase}/settings/thumbnails`, {
      ...requestOptions,
      method: "PATCH",
      body
    });

  /** Fetches background jobs for one library. */
  const listJobs = (libraryId: string) =>
    $fetch<BackgroundJobListResponse>(
      createLibraryApiPath(apiBase, libraryId, ["jobs"]),
      requestOptions
    );

  /** Fetches one background job for scan-completion monitoring. */
  const getJob = (libraryId: string, jobId: string) =>
    $fetch<BackgroundJobResponse>(
      createLibraryApiPath(apiBase, libraryId, ["jobs", jobId]),
      requestOptions
    );

  /** Fetches one bounded page of path-safe failures for a scan job. */
  const listScanFailures = (
    libraryId: string,
    jobId: string,
    query: ScanFailureListQuery = { offset: 0, limit: 100 }
  ) =>
    $fetch<ScanFailureListResponse>(
      createLibraryApiPath(apiBase, libraryId, ["jobs", jobId, "failures"]),
      {
        ...requestOptions,
        query
      }
    );

  /** Cancels one queued or running library job. */
  const cancelJob = (libraryId: string, jobId: string) =>
    $fetch<BackgroundJobResponse>(
      createLibraryApiPath(apiBase, libraryId, ["jobs", jobId]),
      {
        ...requestOptions,
        method: "DELETE"
      }
    );

  /** Starts a scan for one library. */
  const createScanJob = (libraryId: string) =>
    $fetch<BackgroundJobResponse>(
      createLibraryApiPath(apiBase, libraryId, ["jobs", "scan"]),
      {
        ...requestOptions,
        method: "POST",
        body: {}
      }
    );

  return {
    addCollectionBook,
    apiBase,
    archiveBook,
    cancelJob,
    createInitialSetup,
    createCollection,
    createLibrary,
    createScanJob,
    deleteLibrary,
    deleteCollection,
    getBook,
    getCollection,
    getJob,
    getLibraryPreference,
    getNetworkSettings,
    getPageImageUrl,
    getSetupStatus,
    getThumbnailSettings,
    listArchivedBooks,
    listBooks,
    listCollections,
    listJobs,
    listLibraries,
    listScanFailures,
    restoreBook,
    lockLibrary,
    unlockLibrary,
    importLibraryBook,
    removeCollectionBook,
    reorderCollectionBooks,
    updateBookMetadata,
    updateBookProgress,
    updateCollection,
    updateLibrary,
    updateLibraryPreference,
    updateNetworkSettings,
    updateThumbnailSettings
  };
};
