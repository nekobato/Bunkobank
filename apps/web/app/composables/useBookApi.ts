/**
 * Authenticated API helpers for the BookCafe frontend.
 *
 * @module
 */

import type {
  BackgroundJobListResponse,
  BackgroundJobResponse,
  BookDetailResponse,
  BookListQuery,
  BookListResponse,
  InitialSetupRequest,
  LibraryCreateRequest,
  LibraryListResponse,
  LibraryPreferenceResponse,
  LibraryResponse,
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
} from "@bookcafe/contracts";

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

  /** Deletes BookCafe records for one library without touching source files. */
  const deleteLibrary = (libraryId: string) =>
    $fetch<void>(createLibraryApiPath(apiBase, libraryId), {
      ...requestOptions,
      method: "DELETE"
    });

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
    apiBase,
    archiveBook,
    cancelJob,
    createInitialSetup,
    createLibrary,
    createScanJob,
    deleteLibrary,
    getBook,
    getJob,
    getLibraryPreference,
    getNetworkSettings,
    getPageImageUrl,
    getSetupStatus,
    getThumbnailSettings,
    listArchivedBooks,
    listBooks,
    listJobs,
    listLibraries,
    listScanFailures,
    restoreBook,
    updateBookMetadata,
    updateBookProgress,
    updateLibrary,
    updateLibraryPreference,
    updateNetworkSettings,
    updateThumbnailSettings
  };
};
