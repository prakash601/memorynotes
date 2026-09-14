import { createHash } from "node:crypto";

/**
 * Idempotency keys (doc 09). Doc 03 puts these in Redis, so this is a store
 * seam with an in-memory default; Redis is a drop-in for production.
 */
export interface IdempotencyRecord {
  /** Hash of method + path + body, so a different body under the same key conflicts. */
  fingerprint: string;
  status: number;
  body: string;
  contentType: string;
  createdAt: number;
}

export interface IdempotencyStore {
  get(scopeKey: string): Promise<IdempotencyRecord | null>;
  put(scopeKey: string, record: IdempotencyRecord): Promise<void>;
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

export function createMemoryIdempotencyStore(ttlMs: number = IDEMPOTENCY_TTL_MS): IdempotencyStore {
  const entries = new Map<string, IdempotencyRecord>();

  function prune(now: number) {
    for (const [key, record] of entries) {
      if (record.createdAt + ttlMs <= now) {
        entries.delete(key);
      }
    }
  }

  return {
    async get(scopeKey) {
      const record = entries.get(scopeKey);
      if (!record) {
        return null;
      }
      if (record.createdAt + ttlMs <= Date.now()) {
        entries.delete(scopeKey);
        return null;
      }
      return record;
    },
    async put(scopeKey, record) {
      prune(Date.now());
      entries.set(scopeKey, record);
    },
  };
}

export function requestFingerprint(method: string, path: string, body: string): string {
  return createHash("sha256").update(`${method.toUpperCase()}\n${path}\n${body}`).digest("hex");
}
