import { MAX_CONTENT_BYTES } from "./constants";
import { ContentTooLargeError, ValidationError } from "./errors";

export const MAX_TITLE_LENGTH = 500;

export function normalizeTitle(title: string | undefined | null): string {
  const value = (title ?? "").trim();
  if (value.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(`Title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  }
  return value;
}

export function normalizeContent(content: string | undefined | null): string {
  return content ?? "";
}

/** Content limit is measured in bytes, not characters (doc 01). */
export function assertContentSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    throw new ContentTooLargeError();
  }
}
