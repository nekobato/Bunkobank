/** In-memory BEC1 key lifecycle for managed encrypted libraries. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createBec1LibraryEncryptor,
  openBec1LibraryEncryptor,
  type Bec1LibraryEncryptor
} from "@bunkobank/encrypted-container";

import type { LibraryRecord } from "@bunkobank/db";

export const encryptedLibraryKeyFileName = ".bunkobank-library-key.bbec";

export interface EncryptedLibraryKeyring {
  initialize(library: LibraryRecord, password: string): Promise<void>;
  unlock(library: LibraryRecord, password: string): Promise<void>;
  lock(libraryId: string): void;
  isUnlocked(libraryId: string): boolean;
  get(libraryId: string): Bec1LibraryEncryptor | null;
  dispose(): void;
}

/**
 * Creates a process-local keyring. Passwords are used only to wrap or unwrap
 * the BEC1 master key and are never retained after an operation completes.
 */
export const createEncryptedLibraryKeyring = (
  cacheDir: string
): EncryptedLibraryKeyring => {
  const unlockedLibraries = new Map<string, Bec1LibraryEncryptor>();

  const lock = (libraryId: string): void => {
    unlockedLibraries.get(libraryId)?.dispose();
    unlockedLibraries.delete(libraryId);
  };

  return {
    initialize: async (library, password) => {
      assertEncryptedLibrary(library);
      lock(library.id);
      await mkdir(cacheDir, { recursive: true });
      const temporaryDir = await mkdtemp(join(cacheDir, "library-key-"));
      const emptyPath = join(temporaryDir, "empty");
      const encryptor = await createBec1LibraryEncryptor({
        libraryId: library.id,
        password
      });

      try {
        await writeFile(emptyPath, Buffer.alloc(0), { mode: 0o600 });
        await encryptor.encryptFile({
          inputPath: emptyPath,
          outputPath: join(
            library.canonicalRootPath,
            encryptedLibraryKeyFileName
          ),
          recovery: {
            originalName: "Bunkobank Library Key",
            mediaKind: "library-key"
          }
        });
        unlockedLibraries.set(library.id, encryptor);
      } catch (error) {
        encryptor.dispose();
        throw error;
      } finally {
        await rm(temporaryDir, { recursive: true, force: true });
      }
    },
    unlock: async (library, password) => {
      assertEncryptedLibrary(library);
      const encryptor = await openBec1LibraryEncryptor(
        join(library.canonicalRootPath, encryptedLibraryKeyFileName),
        password
      );

      if (encryptor.libraryId !== library.id) {
        encryptor.dispose();
        throw new Error(
          "Encrypted library key does not match its database id."
        );
      }

      lock(library.id);
      unlockedLibraries.set(library.id, encryptor);
    },
    lock,
    isUnlocked: (libraryId) => unlockedLibraries.has(libraryId),
    get: (libraryId) => unlockedLibraries.get(libraryId) ?? null,
    dispose: () => {
      for (const encryptor of unlockedLibraries.values()) {
        encryptor.dispose();
      }
      unlockedLibraries.clear();
    }
  };
};

const assertEncryptedLibrary = (library: LibraryRecord): void => {
  if (library.kind !== "encrypted") {
    throw new Error("A directory library does not have an encryption key.");
  }
};
