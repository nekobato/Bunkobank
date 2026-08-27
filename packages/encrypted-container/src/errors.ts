export type Bec1ErrorCode =
  | "AUTHENTICATION_FAILED"
  | "CLOSED"
  | "INVALID_CONTAINER"
  | "INVALID_RANGE"
  | "MANIFEST_TOO_LARGE"
  | "OUTPUT_EXISTS"
  | "SOURCE_CHANGED"
  | "UNSAFE_PARAMETERS"
  | "UNSUPPORTED_VERSION";

/** Error with a stable code suitable for recovery tools and HTTP adapters. */
export class Bec1Error extends Error {
  readonly code: Bec1ErrorCode;

  constructor(code: Bec1ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Bec1Error";
    this.code = code;
  }
}

export const asAuthenticationError = (cause: unknown): Bec1Error =>
  cause instanceof Bec1Error && cause.code === "AUTHENTICATION_FAILED"
    ? cause
    : new Bec1Error(
        "AUTHENTICATION_FAILED",
        "The password is incorrect or the container has been modified.",
        { cause }
      );
