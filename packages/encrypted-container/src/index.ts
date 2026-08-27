export {
  BEC1_DEFAULT_CHUNK_SIZE,
  BEC1_DEFAULT_KDF,
  BEC1_DESCRIPTOR_SIZE,
  BEC1_MAX_BUFFERED_RANGE_SIZE
} from "./constants.js";
export {
  createBec1LibraryEncryptor,
  decryptBec1File,
  inspectBec1File,
  openBec1Container,
  openBec1LibraryEncryptor,
  rewrapBec1FilePassword
} from "./container.js";
export { Bec1Error, type Bec1ErrorCode } from "./errors.js";
export type {
  Bec1ByteRange,
  Bec1ContainerInfo,
  Bec1KdfParameters,
  Bec1LibraryEncryptor,
  Bec1OpenContainer,
  Bec1RecoveryManifest,
  Bec1RecoveryMetadataInput,
  CreateBec1LibraryEncryptorOptions,
  DecryptBec1FileOptions,
  EncryptBec1FileOptions,
  RewrapBec1FilePasswordOptions
} from "./types.js";
