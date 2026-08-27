import { Bec1Error } from "./errors.js";
import type {
  Bec1RecoveryManifest,
  Bec1RecoveryMetadataInput
} from "./types.js";

type CborScalar = number | string | Buffer;

const encodeHead = (major: number, value: number): Buffer => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid CBOR integer value.");
  }
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value <= 0xff) return Buffer.from([(major << 5) | 24, value]);
  if (value <= 0xffff) {
    const result = Buffer.alloc(3);
    result[0] = (major << 5) | 25;
    result.writeUInt16BE(value, 1);
    return result;
  }
  if (value <= 0xffff_ffff) {
    const result = Buffer.alloc(5);
    result[0] = (major << 5) | 26;
    result.writeUInt32BE(value, 1);
    return result;
  }

  const result = Buffer.alloc(9);
  result[0] = (major << 5) | 27;
  result.writeBigUInt64BE(BigInt(value), 1);
  return result;
};

const encodeValue = (value: CborScalar): Buffer => {
  if (typeof value === "number") return encodeHead(0, value);
  if (typeof value === "string") {
    const encoded = Buffer.from(value, "utf8");
    return Buffer.concat([encodeHead(3, encoded.byteLength), encoded]);
  }
  return Buffer.concat([encodeHead(2, value.byteLength), value]);
};

/** Encodes the BEC1 recovery manifest as deterministic RFC 8949 CBOR. */
export const encodeRecoveryManifest = (
  recovery: Bec1RecoveryMetadataInput,
  originalName: string,
  sha256: Uint8Array
): Buffer => {
  const entries: Array<readonly [number, CborScalar]> = [
    [0, 1],
    [1, originalName]
  ];

  const optional: Array<readonly [number, keyof Bec1RecoveryMetadataInput]> = [
    [2, "mimeType"],
    [3, "mediaKind"],
    [4, "itemId"],
    [5, "assetRole"],
    [6, "sequence"],
    [7, "logicalPath"],
    [8, "modifiedAt"]
  ];
  for (const [key, field] of optional) {
    const value = recovery[field];
    if (value !== undefined) entries.push([key, value]);
  }
  entries.push([9, Buffer.from(sha256)]);

  const encodedEntries = entries.flatMap(([key, value]) => [
    encodeHead(0, key),
    encodeValue(value)
  ]);
  return Buffer.concat([encodeHead(5, entries.length), ...encodedEntries]);
};

interface DecodeCursor {
  source: Buffer;
  offset: number;
}

const readLength = (cursor: DecodeCursor, additional: number): number => {
  const need = (length: number): void => {
    if (cursor.offset + length > cursor.source.byteLength) {
      throw new Bec1Error("INVALID_CONTAINER", "Truncated CBOR manifest.");
    }
  };

  if (additional < 24) return additional;
  if (additional === 24) {
    need(1);
    const value = cursor.source[cursor.offset++] as number;
    if (value < 24) {
      throw new Bec1Error(
        "INVALID_CONTAINER",
        "Non-deterministic CBOR integer."
      );
    }
    return value;
  }
  if (additional === 25) {
    need(2);
    const value = cursor.source.readUInt16BE(cursor.offset);
    cursor.offset += 2;
    if (value <= 0xff) {
      throw new Bec1Error(
        "INVALID_CONTAINER",
        "Non-deterministic CBOR integer."
      );
    }
    return value;
  }
  if (additional === 26) {
    need(4);
    const value = cursor.source.readUInt32BE(cursor.offset);
    cursor.offset += 4;
    if (value <= 0xffff) {
      throw new Bec1Error(
        "INVALID_CONTAINER",
        "Non-deterministic CBOR integer."
      );
    }
    return value;
  }
  if (additional === 27) {
    need(8);
    const value = cursor.source.readBigUInt64BE(cursor.offset);
    cursor.offset += 8;
    if (value <= 0xffff_ffffn) {
      throw new Bec1Error(
        "INVALID_CONTAINER",
        "Non-deterministic CBOR integer."
      );
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Bec1Error("INVALID_CONTAINER", "CBOR integer is too large.");
    }
    return Number(value);
  }
  throw new Bec1Error(
    "INVALID_CONTAINER",
    "Indefinite or reserved CBOR lengths are not accepted."
  );
};

const decodeScalar = (cursor: DecodeCursor): CborScalar => {
  if (cursor.offset >= cursor.source.byteLength) {
    throw new Bec1Error("INVALID_CONTAINER", "Truncated CBOR manifest.");
  }
  const head = cursor.source[cursor.offset++] as number;
  const major = head >> 5;
  const length = readLength(cursor, head & 0x1f);

  if (major === 0) return length;
  if (major !== 2 && major !== 3) {
    throw new Bec1Error(
      "INVALID_CONTAINER",
      "The recovery manifest contains an unsupported CBOR value."
    );
  }
  if (cursor.offset + length > cursor.source.byteLength) {
    throw new Bec1Error("INVALID_CONTAINER", "Truncated CBOR manifest.");
  }
  const bytes = cursor.source.subarray(cursor.offset, cursor.offset + length);
  cursor.offset += length;
  if (major === 2) return Buffer.from(bytes);

  const value = bytes.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(bytes)) {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid UTF-8 in manifest.");
  }
  return value;
};

const requiredString = (
  values: Map<number, CborScalar>,
  key: number
): string => {
  const value = values.get(key);
  if (typeof value !== "string") {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid recovery manifest.");
  }
  return value;
};

const optionalString = (
  values: Map<number, CborScalar>,
  key: number
): string | undefined => {
  const value = values.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid recovery manifest.");
  }
  return value;
};

const optionalNumber = (
  values: Map<number, CborScalar>,
  key: number
): number | undefined => {
  const value = values.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid recovery manifest.");
  }
  return value;
};

/** Decodes the bounded deterministic CBOR subset used by BEC1 manifests. */
export const decodeRecoveryManifest = (
  encoded: Uint8Array
): Bec1RecoveryManifest => {
  const cursor: DecodeCursor = { source: Buffer.from(encoded), offset: 0 };
  if (cursor.source.byteLength === 0) {
    throw new Bec1Error("INVALID_CONTAINER", "Empty recovery manifest.");
  }
  const head = cursor.source[cursor.offset++] as number;
  if (head >> 5 !== 5) {
    throw new Bec1Error("INVALID_CONTAINER", "Manifest must be a CBOR map.");
  }
  const entryCount = readLength(cursor, head & 0x1f);
  if (entryCount > 32) {
    throw new Bec1Error("INVALID_CONTAINER", "Manifest has too many entries.");
  }

  const values = new Map<number, CborScalar>();
  let previousKey = -1;
  for (let index = 0; index < entryCount; index += 1) {
    const key = decodeScalar(cursor);
    if (typeof key !== "number" || key <= previousKey) {
      throw new Bec1Error(
        "INVALID_CONTAINER",
        "Manifest keys must be unique ascending integers."
      );
    }
    previousKey = key;
    values.set(key, decodeScalar(cursor));
  }
  if (cursor.offset !== cursor.source.byteLength || values.get(0) !== 1) {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid recovery manifest.");
  }

  const digest = values.get(9);
  if (!Buffer.isBuffer(digest) || digest.byteLength !== 32) {
    throw new Bec1Error("INVALID_CONTAINER", "Invalid plaintext digest.");
  }

  return {
    version: 1,
    originalName: requiredString(values, 1),
    mimeType: optionalString(values, 2),
    mediaKind: optionalString(values, 3),
    itemId: optionalString(values, 4),
    assetRole: optionalString(values, 5),
    sequence: optionalNumber(values, 6),
    logicalPath: optionalString(values, 7),
    modifiedAt: optionalNumber(values, 8),
    plaintextSha256: digest.toString("hex")
  };
};
