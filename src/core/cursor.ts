import { ValidationError } from "./errors";

/** Opaque, URL-safe keyset cursors (doc 09). */
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string): T {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("not an object");
    }
    return parsed as T;
  } catch {
    throw new ValidationError("Invalid cursor");
  }
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export function normalizeLimit(limit: number | undefined, fallback = DEFAULT_PAGE_LIMIT): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_LIMIT);
}
