/**
 * Pure helpers for restoring a user's selected library.
 *
 * @module
 */

import type { LibraryResponse } from "@bookcafe/contracts";

/** Result of reconciling persisted selection with the current libraries. */
export interface LibrarySelectionResolution {
  libraryId: string | null;
  shouldPersist: boolean;
}

/**
 * Keeps an existing preference or falls back to the first available library.
 */
export const resolveLibrarySelection = (
  libraries: readonly LibraryResponse[],
  preferredLibraryId: string | null
): LibrarySelectionResolution => {
  if (
    preferredLibraryId &&
    libraries.some(({ id }) => id === preferredLibraryId)
  ) {
    return {
      libraryId: preferredLibraryId,
      shouldPersist: false
    };
  }

  const libraryId = libraries[0]?.id ?? null;

  return {
    libraryId,
    shouldPersist: libraryId !== preferredLibraryId
  };
};
