import { RateLimitedError } from "./errors";

/**
 * Rate-limit numbers from doc 06 (A6). They are starting points and will be
 * tuned from real traffic; they live here as the single source of truth.
 *
 * The doc places counters in Redis (`03`: "Rate-limit counters ... live in
 * Redis, not Postgres"). This module depends on the `RateLimitStore` seam, so
 * the in-memory store below is the local/test driver and Redis is a drop-in.
 */
export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  note_create_account: { name: "note_create_account", limit: 50, windowSeconds: 86_400 },
  note_create_ip: { name: "note_create_ip", limit: 200, windowSeconds: 86_400 },
  publish_account: { name: "publish_account", limit: 200, windowSeconds: 86_400 },
  api_token_minute: { name: "api_token_minute", limit: 120, windowSeconds: 60 },
  api_account_minute: { name: "api_account_minute", limit: 600, windowSeconds: 60 },
  // Uploads are bounded by bytes, not requests: 100 x 5 MiB/hour caps one
  // account at ~500 MiB/hour of stored images.
  image_upload_hour: { name: "image_upload_hour", limit: 100, windowSeconds: 3_600 },
  mcp_token_minute: { name: "mcp_token_minute", limit: 60, windowSeconds: 60 },
  mcp_create_hour: { name: "mcp_create_hour", limit: 20, windowSeconds: 3_600 },
  read_ip_minute: { name: "read_ip_minute", limit: 1_000, windowSeconds: 60 },
  report_ip_hour: { name: "report_ip_hour", limit: 20, windowSeconds: 3_600 },
  share_password_attempt: { name: "share_password_attempt", limit: 10, windowSeconds: 600 },
  oauth_register_hour: { name: "oauth_register_hour", limit: 10, windowSeconds: 3_600 },
  oauth_token_minute: { name: "oauth_token_minute", limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMITS;

export interface RateLimitState {
  allowed: boolean;
  policy: string;
  limit: number;
  remaining: number;
  /** Epoch milliseconds at which the current window resets. */
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, policy: RateLimitPolicy, nowMs: number): Promise<RateLimitState>;
}

/**
 * Fixed-window counter. Fixed windows trade a small boundary burst for a tiny,
 * dependency-free implementation; the API-level cap is what matters.
 */
export function createMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function prune(nowMs: number) {
    if (buckets.size < 10_000) {
      return;
    }
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= nowMs) {
        buckets.delete(key);
      }
    }
  }

  return {
    async hit(key, policy, nowMs) {
      const windowMs = policy.windowSeconds * 1_000;
      const windowStart = Math.floor(nowMs / windowMs) * windowMs;
      const resetAt = windowStart + windowMs;
      const bucketKey = `${policy.name}:${key}`;

      prune(nowMs);

      const existing = buckets.get(bucketKey);
      const bucket = existing && existing.resetAt === resetAt ? existing : { count: 0, resetAt };
      bucket.count += 1;
      buckets.set(bucketKey, bucket);

      return {
        allowed: bucket.count <= policy.limit,
        policy: policy.name,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - bucket.count),
        resetAt,
      };
    },
  };
}

/**
 * Consumes one unit and throws `RateLimitedError` when the limit is exceeded.
 * The returned state lets the transport emit the doc 09 headers on success.
 */
export async function enforceRateLimit(
  store: RateLimitStore,
  policy: RateLimitPolicy,
  key: string,
  nowMs: number = Date.now(),
): Promise<RateLimitState> {
  const state = await store.hit(key, policy, nowMs);
  if (!state.allowed) {
    const retryAfter = Math.ceil((state.resetAt - nowMs) / 1_000);
    throw new RateLimitedError(retryAfter, {
      policy: state.policy,
      limit: state.limit,
      reset_at: new Date(state.resetAt).toISOString(),
    });
  }
  return state;
}

/** `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (doc 09). */
export function rateLimitHeaders(state: RateLimitState): Record<string, string> {
  return {
    "RateLimit-Limit": String(state.limit),
    "RateLimit-Remaining": String(state.remaining),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((state.resetAt - Date.now()) / 1_000))),
  };
}
