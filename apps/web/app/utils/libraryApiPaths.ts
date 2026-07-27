/**
 * URL helpers for the library-scoped API.
 *
 * @module
 */

/**
 * Builds an encoded endpoint below one library.
 */
export const createLibraryApiPath = (
  apiBase: string,
  libraryId: string,
  segments: readonly string[] = []
): string =>
  [
    apiBase.replace(/\/$/, ""),
    "libraries",
    encodeURIComponent(libraryId),
    ...segments.map(encodeURIComponent)
  ].join("/");

/**
 * Resolves a server-returned API asset URL against an absolute development API.
 */
export const resolveApiAssetUrl = (
  apiBase: string,
  assetUrl: string
): string => {
  if (!apiBase.startsWith("http://") && !apiBase.startsWith("https://")) {
    return assetUrl;
  }

  const apiUrl = new URL(apiBase);

  return new URL(assetUrl, apiUrl.origin).toString();
};
