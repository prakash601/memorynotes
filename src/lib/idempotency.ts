import { NextResponse } from "next/server";
import {
  ValidationError,
  createMemoryIdempotencyStore,
  requestFingerprint,
  type IdempotencyStore,
} from "@/core";

let store: IdempotencyStore | undefined;

/** One process-wide store. Doc 03 puts these in Redis in production. */
export function getIdempotencyStore(): IdempotencyStore {
  store ??= createMemoryIdempotencyStore();
  return store;
}

/** Test helper. */
export function resetIdempotencyStore(): void {
  store = undefined;
}

export interface IdempotencyContext {
  /** Present when this key was already applied; return it verbatim. */
  replay: NextResponse | null;
  complete: (response: NextResponse) => Promise<NextResponse>;
}

/**
 * Honors `Idempotency-Key` on a write (doc 09). The key is scoped per account,
 * method, and path; the body is fingerprinted so the same key with a different
 * body is a conflict rather than a silent no-op.
 */
export async function beginIdempotency(
  request: Request,
  principal: { userId: string },
  bodyText: string,
): Promise<IdempotencyContext> {
  const key = request.headers.get("idempotency-key");
  if (!key) {
    return { replay: null, complete: async (response) => response };
  }

  const path = new URL(request.url).pathname;
  const scopeKey = `${principal.userId}:${request.method.toUpperCase()}:${path}:${key}`;
  const fingerprint = requestFingerprint(request.method, path, bodyText);
  const existing = await getIdempotencyStore().get(scopeKey);

  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new ValidationError("Idempotency-Key was reused with a different request body");
    }
    return {
      replay: new NextResponse(existing.body, {
        status: existing.status,
        headers: {
          "content-type": existing.contentType,
          "idempotency-replayed": "true",
        },
      }),
      complete: async (response) => response,
    };
  }

  return {
    replay: null,
    complete: async (response) => {
      const body = await response.clone().text();
      await getIdempotencyStore().put(scopeKey, {
        fingerprint,
        status: response.status,
        body,
        contentType: response.headers.get("content-type") ?? "application/json",
        createdAt: Date.now(),
      });
      return response;
    },
  };
}
