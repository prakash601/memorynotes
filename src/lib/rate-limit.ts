import {
  RATE_LIMITS,
  createMemoryRateLimitStore,
  enforceRateLimit,
  rateLimitHeaders,
  type RateLimitPolicyName,
  type RateLimitState,
  type RateLimitStore,
} from "@/core";

let store: RateLimitStore | undefined;

/**
 * One process-wide store. Per doc 03 the production driver is Redis; the
 * interface is the same, so only this factory changes.
 */
export function getRateLimitStore(): RateLimitStore {
  store ??= createMemoryRateLimitStore();
  return store;
}

/** Test helper. */
export function resetRateLimitStore(): void {
  store = undefined;
}

export function limit(
  policy: RateLimitPolicyName,
  key: string,
  nowMs?: number,
): Promise<RateLimitState> {
  return enforceRateLimit(getRateLimitStore(), RATE_LIMITS[policy], key, nowMs);
}

export { rateLimitHeaders };
