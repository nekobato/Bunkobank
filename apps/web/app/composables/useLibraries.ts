/**
 * Shared client state for configured libraries and the user's selection.
 *
 * @module
 */

import type { LibraryResponse } from "@bunkobank/contracts";

import { resolveLibrarySelection } from "../utils/librarySelection";

/**
 * Provides library loading, selection, and preference persistence.
 */
export const useLibraries = () => {
  const libraries = useState<LibraryResponse[]>(
    "bunkobank-libraries",
    () => []
  );
  const selectedLibraryId = useState<string | null>(
    "bunkobank-selected-library",
    () => null
  );
  const loading = useState("bunkobank-libraries-loading", () => false);
  const loaded = useState("bunkobank-libraries-loaded", () => false);
  const error = useState<unknown | null>(
    "bunkobank-libraries-error",
    () => null
  );
  const { getLibraryPreference, listLibraries, updateLibraryPreference } =
    useBookApi();

  const selectedLibrary = computed(
    () =>
      libraries.value.find(({ id }) => id === selectedLibraryId.value) ?? null
  );

  /** Reloads libraries and reconciles them with the persisted preference. */
  const refreshLibraries = async (): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const [libraryResponse, preference] = await Promise.all([
        listLibraries(),
        getLibraryPreference()
      ]);
      const selection = resolveLibrarySelection(
        libraryResponse.libraries,
        preference.libraryId
      );

      libraries.value = libraryResponse.libraries;
      selectedLibraryId.value = selection.libraryId;
      loaded.value = true;

      if (selection.shouldPersist) {
        await updateLibraryPreference({ libraryId: selection.libraryId });
      }
    } catch (cause) {
      error.value = cause;
      throw cause;
    } finally {
      loading.value = false;
    }
  };

  /** Persists and applies one selected library. */
  const selectLibrary = async (libraryId: string): Promise<void> => {
    if (
      selectedLibraryId.value === libraryId ||
      !libraries.value.some(({ id }) => id === libraryId)
    ) {
      return;
    }

    await updateLibraryPreference({ libraryId });
    selectedLibraryId.value = libraryId;
  };

  /** Selects a newly created library after refreshing the collection. */
  const selectCreatedLibrary = async (libraryId: string): Promise<void> => {
    await refreshLibraries();
    await selectLibrary(libraryId);
  };

  /** Clears client-only state after sign-out. */
  const resetLibraries = (): void => {
    libraries.value = [];
    selectedLibraryId.value = null;
    loaded.value = false;
    loading.value = false;
    error.value = null;
  };

  return {
    error,
    libraries,
    loaded,
    loading,
    refreshLibraries,
    resetLibraries,
    selectCreatedLibrary,
    selectedLibrary,
    selectedLibraryId,
    selectLibrary
  };
};
