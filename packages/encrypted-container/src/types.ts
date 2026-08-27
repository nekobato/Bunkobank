export interface Bec1KdfParameters {
  algorithm: "argon2id";
  version: 0x13;
  memoryKiB: number;
  passes: number;
  parallelism: number;
  tagLength: 32;
}

export interface Bec1RecoveryMetadataInput {
  originalName?: string;
  mimeType?: string;
  mediaKind?: string;
  itemId?: string;
  assetRole?: string;
  sequence?: number;
  logicalPath?: string;
  modifiedAt?: number;
}

export interface Bec1RecoveryManifest extends Bec1RecoveryMetadataInput {
  version: 1;
  originalName: string;
  plaintextSha256: string;
}

export interface Bec1ContainerInfo {
  format: "BEC1";
  version: 1;
  suite: 1;
  generation: number;
  libraryId: string;
  assetId: string;
  plaintextSize: number;
  chunkSize: number;
  chunkCount: number;
  encryptedSize: number;
  kdf: Bec1KdfParameters;
}

export interface Bec1ByteRange {
  start: number;
  endExclusive: number;
}

export interface EncryptBec1FileOptions {
  inputPath: string;
  outputPath: string;
  assetId?: string;
  chunkSize?: number;
  recovery?: Bec1RecoveryMetadataInput;
}

export interface DecryptBec1FileOptions {
  inputPath: string;
  outputPath: string;
  password: string;
}

export interface RewrapBec1FilePasswordOptions {
  inputPath: string;
  oldPassword: string;
  newPassword: string;
  kdf?: Partial<
    Pick<Bec1KdfParameters, "memoryKiB" | "passes" | "parallelism">
  >;
}

export interface Bec1OpenContainer {
  info: Bec1ContainerInfo;
  manifest: Bec1RecoveryManifest;
  readRange(range: Bec1ByteRange): Promise<Buffer>;
  iterateRange(range?: Bec1ByteRange): AsyncIterable<Buffer>;
  close(): Promise<void>;
}

export interface Bec1LibraryEncryptor {
  readonly libraryId: string;
  encryptFile(options: EncryptBec1FileOptions): Promise<Bec1ContainerInfo>;
  dispose(): void;
}

export interface CreateBec1LibraryEncryptorOptions {
  password: string;
  libraryId?: string;
  kdf?: Partial<
    Pick<Bec1KdfParameters, "memoryKiB" | "passes" | "parallelism">
  >;
}
