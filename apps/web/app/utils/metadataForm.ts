import type {
  BookDetailResponse,
  UpdateBookMetadataRequest
} from "@bookcafe/contracts";

export interface MetadataForm {
  title: string;
  authors: string;
  publisher: string;
  isbn: string;
  purchasedAt: string;
  readingStatus: BookDetailResponse["readingStatus"];
  tags: string;
  notes: string;
}

/**
 * Creates an empty editable metadata form model.
 */
export function createEmptyMetadataForm(): MetadataForm {
  return {
    title: "",
    authors: "",
    publisher: "",
    isbn: "",
    purchasedAt: "",
    readingStatus: "unread",
    tags: "",
    notes: ""
  };
}

/**
 * Converts an API book detail into editable form text.
 */
export function toMetadataForm(book: BookDetailResponse): MetadataForm {
  return {
    title: book.title,
    authors: book.authors.join("\n"),
    publisher: book.publisher ?? "",
    isbn: book.isbn ?? "",
    purchasedAt: book.purchasedAt ?? "",
    readingStatus: book.readingStatus,
    tags: book.tags.join(", "),
    notes: book.notes ?? ""
  };
}

/**
 * Converts editable form text into the metadata update request.
 */
export function toMetadataRequest(
  value: MetadataForm
): UpdateBookMetadataRequest {
  return {
    title: value.title,
    authors: splitList(value.authors),
    publisher: toNullableText(value.publisher),
    isbn: toNullableText(value.isbn),
    purchasedAt: toNullableText(value.purchasedAt),
    readingStatus: value.readingStatus,
    tags: splitList(value.tags),
    notes: toNullableText(value.notes)
  };
}

/**
 * Splits comma or newline separated text into unique values.
 */
function splitList(value: string): string[] {
  const seen = new Set<string>();

  return value.split(/[\n,]/u).flatMap((item) => {
    const normalizedItem = item.trim();

    if (normalizedItem.length < 1 || seen.has(normalizedItem)) {
      return [];
    }

    seen.add(normalizedItem);
    return [normalizedItem];
  });
}

/**
 * Converts blank text to null for optional metadata fields.
 */
function toNullableText(value: string): string | null {
  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}
