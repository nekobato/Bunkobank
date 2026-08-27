import { Bec1Error } from "./errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidToBytes = (uuid: string): Buffer => {
  if (!UUID_PATTERN.test(uuid)) {
    throw new Bec1Error("INVALID_CONTAINER", `Invalid UUID: ${uuid}`);
  }

  return Buffer.from(uuid.replaceAll("-", ""), "hex");
};

export const bytesToUuid = (bytes: Uint8Array): string => {
  if (bytes.byteLength !== 16) {
    throw new Bec1Error("INVALID_CONTAINER", "A UUID must contain 16 bytes.");
  }

  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
