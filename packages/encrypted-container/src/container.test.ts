import { createHash } from "node:crypto";
import {
  mkdtemp,
  open,
  readFile,
  rm,
  truncate,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BEC1_DESCRIPTOR_SIZE, BEC1_GCM_TAG_SIZE } from "./constants.js";
import {
  createBec1LibraryEncryptor,
  decryptBec1File,
  inspectBec1File,
  openBec1Container,
  openBec1LibraryEncryptor,
  rewrapBec1FilePassword
} from "./container.js";
import { Bec1Error } from "./errors.js";

const directories: string[] = [];

const createDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "bunkobank-bec1-"));
  directories.push(directory);
  return directory;
};

const makeContent = (size: number): Buffer => {
  const result = Buffer.alloc(size);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = (index * 31 + 17) & 0xff;
  }
  return result;
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("BEC1 container", () => {
  it("recovers a file and serves authenticated ranges without database state", async () => {
    const directory = await createDirectory();
    const inputPath = join(directory, "movie.bin");
    const containerPath = join(directory, "asset.bbec");
    const recoveredPath = join(directory, "recovered.bin");
    const content = makeContent(150 * 1024 + 37);
    await writeFile(inputPath, content);

    const encryptor = await createBec1LibraryEncryptor({
      password: "correct horse battery staple"
    });
    const encrypted = await encryptor.encryptFile({
      inputPath,
      outputPath: containerPath,
      chunkSize: 64 * 1024,
      recovery: {
        originalName: "movie-original.bin",
        mimeType: "application/octet-stream",
        mediaKind: "video",
        logicalPath: "Films/Example"
      }
    });
    encryptor.dispose();

    expect(await inspectBec1File(containerPath)).toEqual(encrypted);
    const container = await openBec1Container(
      containerPath,
      "correct horse battery staple"
    );
    try {
      expect(container.manifest).toMatchObject({
        originalName: "movie-original.bin",
        mediaKind: "video",
        logicalPath: "Films/Example",
        plaintextSha256: createHash("sha256").update(content).digest("hex")
      });
      expect(
        await container.readRange({
          start: 64 * 1024 - 19,
          endExclusive: 64 * 1024 + 23
        })
      ).toEqual(content.subarray(64 * 1024 - 19, 64 * 1024 + 23));
      expect(
        await container.readRange({
          start: content.length,
          endExclusive: content.length
        })
      ).toEqual(Buffer.alloc(0));
    } finally {
      await container.close();
    }

    await decryptBec1File({
      inputPath: containerPath,
      outputPath: recoveredPath,
      password: "correct horse battery staple"
    });
    expect(await readFile(recoveredPath)).toEqual(content);
  });

  it("recovers from a damaged primary descriptor using its mirror", async () => {
    const directory = await createDirectory();
    const inputPath = join(directory, "image.bin");
    const containerPath = join(directory, "image.bbec");
    const content = makeContent(80 * 1024);
    await writeFile(inputPath, content);
    const encryptor = await createBec1LibraryEncryptor({ password: "secret" });
    await encryptor.encryptFile({
      inputPath,
      outputPath: containerPath,
      chunkSize: 64 * 1024
    });
    encryptor.dispose();

    const handle = await open(containerPath, "r+");
    try {
      await handle.write(Buffer.from([0xff]), 0, 1, 0);
    } finally {
      await handle.close();
    }
    const container = await openBec1Container(containerPath, "secret");
    try {
      expect(
        await container.readRange({ start: 0, endExclusive: content.length })
      ).toEqual(content);
    } finally {
      await container.close();
    }
  });

  it("rejects the wrong password and authenticated chunk modification", async () => {
    const directory = await createDirectory();
    const inputPath = join(directory, "video.bin");
    const containerPath = join(directory, "video.bbec");
    const content = makeContent(130 * 1024);
    await writeFile(inputPath, content);
    const encryptor = await createBec1LibraryEncryptor({ password: "secret" });
    await encryptor.encryptFile({
      inputPath,
      outputPath: containerPath,
      chunkSize: 64 * 1024
    });
    encryptor.dispose();

    await expect(
      openBec1Container(containerPath, "wrong")
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED"
    });

    const handle = await open(containerPath, "r+");
    try {
      const position = BEC1_DESCRIPTOR_SIZE + 100;
      const original = Buffer.alloc(1);
      await handle.read(original, 0, 1, position);
      original[0] = (original[0] as number) ^ 0x80;
      await handle.write(original, 0, 1, position);
    } finally {
      await handle.close();
    }
    const container = await openBec1Container(containerPath, "secret");
    try {
      await expect(
        container.readRange({ start: 0, endExclusive: 1024 })
      ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    } finally {
      await container.close();
    }
  });

  it("rejects chunk reordering, truncation, invalid ranges, and output overwrite", async () => {
    const directory = await createDirectory();
    const inputPath = join(directory, "source.bin");
    const containerPath = join(directory, "source.bbec");
    const content = makeContent(160 * 1024);
    await writeFile(inputPath, content);
    const encryptor = await createBec1LibraryEncryptor({ password: "secret" });
    await encryptor.encryptFile({
      inputPath,
      outputPath: containerPath,
      chunkSize: 64 * 1024
    });

    await expect(
      encryptor.encryptFile({
        inputPath,
        outputPath: containerPath,
        chunkSize: 64 * 1024
      })
    ).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    encryptor.dispose();

    const handle = await open(containerPath, "r+");
    try {
      const encryptedChunkLength = 64 * 1024 + BEC1_GCM_TAG_SIZE;
      const first = Buffer.alloc(encryptedChunkLength);
      const second = Buffer.alloc(encryptedChunkLength);
      await handle.read(first, 0, first.length, BEC1_DESCRIPTOR_SIZE);
      await handle.read(
        second,
        0,
        second.length,
        BEC1_DESCRIPTOR_SIZE + encryptedChunkLength
      );
      await handle.write(second, 0, second.length, BEC1_DESCRIPTOR_SIZE);
      await handle.write(
        first,
        0,
        first.length,
        BEC1_DESCRIPTOR_SIZE + encryptedChunkLength
      );
    } finally {
      await handle.close();
    }
    const container = await openBec1Container(containerPath, "secret");
    try {
      await expect(
        container.readRange({ start: 0, endExclusive: 1024 })
      ).rejects.toBeInstanceOf(Bec1Error);
      await expect(
        container.readRange({ start: -1, endExclusive: 1 })
      ).rejects.toMatchObject({ code: "INVALID_RANGE" });
    } finally {
      await container.close();
    }

    const size = (await statSize(containerPath)) - 1;
    await truncate(containerPath, size);
    await expect(inspectBec1File(containerPath)).rejects.toMatchObject({
      code: "INVALID_CONTAINER"
    });
  });

  it("supports an empty plaintext file", async () => {
    const directory = await createDirectory();
    const inputPath = join(directory, "empty.bin");
    const containerPath = join(directory, "empty.bbec");
    await writeFile(inputPath, Buffer.alloc(0));
    const encryptor = await createBec1LibraryEncryptor({ password: "secret" });
    const info = await encryptor.encryptFile({
      inputPath,
      outputPath: containerPath
    });
    encryptor.dispose();
    expect(info.chunkCount).toBe(0);
    const container = await openBec1Container(containerPath, "secret");
    try {
      expect(await container.readRange({ start: 0, endExclusive: 0 })).toEqual(
        Buffer.alloc(0)
      );
    } finally {
      await container.close();
    }
  });

  it("rewraps descriptors without changing encrypted chunks", async () => {
    const directory = await createDirectory();
    const firstInputPath = join(directory, "first.bin");
    const secondInputPath = join(directory, "second.bin");
    const firstContainerPath = join(directory, "first.bbec");
    const secondContainerPath = join(directory, "second.bbec");
    const firstContent = makeContent(90 * 1024);
    const secondContent = makeContent(70 * 1024);
    await writeFile(firstInputPath, firstContent);
    await writeFile(secondInputPath, secondContent);

    const initialEncryptor = await createBec1LibraryEncryptor({
      password: "old password"
    });
    const libraryId = initialEncryptor.libraryId;
    await initialEncryptor.encryptFile({
      inputPath: firstInputPath,
      outputPath: firstContainerPath,
      chunkSize: 64 * 1024
    });
    initialEncryptor.dispose();
    const before = await readFile(firstContainerPath);

    const changed = await rewrapBec1FilePassword({
      inputPath: firstContainerPath,
      oldPassword: "old password",
      newPassword: "new password"
    });
    const after = await readFile(firstContainerPath);
    expect(changed.generation).toBe(2);
    expect(
      after
        .subarray(BEC1_DESCRIPTOR_SIZE, -BEC1_DESCRIPTOR_SIZE)
        .equals(before.subarray(BEC1_DESCRIPTOR_SIZE, -BEC1_DESCRIPTOR_SIZE))
    ).toBe(true);
    await expect(
      openBec1Container(firstContainerPath, "old password")
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    const reopenedEncryptor = await openBec1LibraryEncryptor(
      firstContainerPath,
      "new password"
    );
    expect(reopenedEncryptor.libraryId).toBe(libraryId);
    const reopenedFirst = await reopenedEncryptor.openFile(firstContainerPath);
    try {
      expect(
        await reopenedFirst.readRange({
          start: 0,
          endExclusive: firstContent.length
        })
      ).toEqual(firstContent);
    } finally {
      await reopenedFirst.close();
    }
    await reopenedEncryptor.encryptFile({
      inputPath: secondInputPath,
      outputPath: secondContainerPath,
      chunkSize: 64 * 1024
    });
    reopenedEncryptor.dispose();
    const second = await openBec1Container(secondContainerPath, "new password");
    try {
      expect(
        await second.readRange({ start: 0, endExclusive: secondContent.length })
      ).toEqual(secondContent);
    } finally {
      await second.close();
    }
  });
});

const statSize = async (path: string): Promise<number> => {
  const handle = await open(path, "r");
  try {
    return (await handle.stat()).size;
  } finally {
    await handle.close();
  }
};
