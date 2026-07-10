import type {
  BackgroundJobListResponse,
  BackgroundJobCreateManyResponse,
  BackgroundJobResponse,
  BookDetailResponse,
  BookListQuery,
  BookListResponse,
  CollectionRootCreateRequest,
  CollectionRootListResponse,
  CollectionRootResponse,
  InitialSetupRequest,
  LibraryExportResponse,
  NetworkSettingsResponse,
  ScanJobCreateRequest,
  SetupStatusResponse,
  ThumbnailSettingsResponse,
  UpdateBookMetadataRequest,
  UpdateNetworkSettingsRequest,
  UpdateBookProgressRequest,
  UpdateThumbnailSettingsRequest
} from "@bookcafe/contracts";

/**
 * Creates small API helpers for the BookCafe frontend.
 */
export const useBookApi = () => {
  const apiBase = useApiBase();

  /**
   * Fetches the available books.
   */
  const listBooks = (query: BookListQuery = {}) =>
    $fetch<BookListResponse>(`${apiBase}/books`, {
      credentials: "include",
      query: {
        q: query.q || undefined,
        readingStatus: query.readingStatus || undefined,
        bookStatus: query.bookStatus || undefined
      }
    });

  /**
   * Exports portable library metadata.
   */
  const exportLibrary = () =>
    $fetch<LibraryExportResponse>(`${apiBase}/library/export`, {
      credentials: "include"
    });

  /**
   * Fetches one book by id.
   */
  const getBook = (bookId: string) =>
    $fetch<BookDetailResponse>(
      `${apiBase}/books/${encodeURIComponent(bookId)}`,
      {
        credentials: "include"
      }
    );

  /**
   * Updates the persisted reading progress for one book.
   */
  const updateBookProgress = (
    bookId: string,
    body: UpdateBookProgressRequest
  ) =>
    $fetch<BookDetailResponse>(
      `${apiBase}/books/${encodeURIComponent(bookId)}/progress`,
      {
        credentials: "include",
        method: "PATCH",
        priority: "low",
        body
      }
    );

  /**
   * Updates user-editable metadata for one book.
   */
  const updateBookMetadata = (
    bookId: string,
    body: UpdateBookMetadataRequest
  ) =>
    $fetch<BookDetailResponse>(
      `${apiBase}/books/${encodeURIComponent(bookId)}/metadata`,
      {
        credentials: "include",
        method: "PATCH",
        body
      }
    );

  /**
   * Fetches current setup status.
   */
  const getSetupStatus = () =>
    $fetch<SetupStatusResponse>(`${apiBase}/setup/status`, {
      credentials: "include"
    });

  /**
   * Creates the initial configured user and server settings.
   */
  const createInitialSetup = (body: InitialSetupRequest) =>
    $fetch<SetupStatusResponse>(`${apiBase}/setup/initial-user`, {
      credentials: "include",
      method: "POST",
      body
    });

  /**
   * Fetches persisted server network settings.
   */
  const getNetworkSettings = () =>
    $fetch<NetworkSettingsResponse>(`${apiBase}/settings/network`, {
      credentials: "include"
    });

  /**
   * Updates persisted server network settings.
   */
  const updateNetworkSettings = (body: UpdateNetworkSettingsRequest) =>
    $fetch<NetworkSettingsResponse>(`${apiBase}/settings/network`, {
      credentials: "include",
      method: "PATCH",
      body
    });

  /**
   * Fetches persisted thumbnail settings.
   */
  const getThumbnailSettings = () =>
    $fetch<ThumbnailSettingsResponse>(`${apiBase}/settings/thumbnails`, {
      credentials: "include"
    });

  /**
   * Updates persisted thumbnail settings.
   */
  const updateThumbnailSettings = (body: UpdateThumbnailSettingsRequest) =>
    $fetch<ThumbnailSettingsResponse>(`${apiBase}/settings/thumbnails`, {
      credentials: "include",
      method: "PATCH",
      body
    });

  /**
   * Fetches configured collection roots.
   */
  const listCollectionRoots = () =>
    $fetch<CollectionRootListResponse>(`${apiBase}/collection-roots`, {
      credentials: "include"
    });

  /**
   * Creates or updates a collection root.
   */
  const createCollectionRoot = (body: CollectionRootCreateRequest) =>
    $fetch<CollectionRootResponse>(`${apiBase}/collection-roots`, {
      credentials: "include",
      method: "POST",
      body
    });

  /**
   * Deletes an empty collection root.
   */
  const deleteCollectionRoot = (collectionRootId: string) =>
    $fetch<void>(
      `${apiBase}/collection-roots/${encodeURIComponent(collectionRootId)}`,
      {
        credentials: "include",
        method: "DELETE"
      }
    );

  /**
   * Fetches background jobs.
   */
  const listJobs = () =>
    $fetch<BackgroundJobListResponse>(`${apiBase}/jobs`, {
      credentials: "include"
    });

  /**
   * Starts a collection-root scan job.
   */
  const createScanJob = (body: ScanJobCreateRequest) =>
    $fetch<BackgroundJobResponse>(`${apiBase}/jobs/scan`, {
      credentials: "include",
      method: "POST",
      body
    });

  /**
   * Starts scan jobs for every configured collection root.
   */
  const createScanAllJobs = () =>
    $fetch<BackgroundJobCreateManyResponse>(`${apiBase}/jobs/scan-all`, {
      credentials: "include",
      method: "POST"
    });

  return {
    apiBase,
    createCollectionRoot,
    createInitialSetup,
    createScanAllJobs,
    createScanJob,
    deleteCollectionRoot,
    exportLibrary,
    listBooks,
    listCollectionRoots,
    listJobs,
    getBook,
    getNetworkSettings,
    getSetupStatus,
    getThumbnailSettings,
    updateBookMetadata,
    updateNetworkSettings,
    updateBookProgress,
    updateThumbnailSettings
  };
};
