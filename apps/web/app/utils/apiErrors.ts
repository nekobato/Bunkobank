/**
 * Extracts a compact user-facing API error message.
 */
export const getApiErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  const responseMessage = getResponseMessage(error);

  if (responseMessage) {
    return responseMessage;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};

/**
 * Reads a JSON `{ message }` body from Nuxt `$fetch`/ofetch style errors.
 */
const getResponseMessage = (error: unknown): string | null => {
  if (!isRecord(error) || !isRecord(error.data)) {
    return null;
  }

  const message = error.data.message;

  return typeof message === "string" && message.length > 0 ? message : null;
};

/**
 * Narrows unknown values to indexable records.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
