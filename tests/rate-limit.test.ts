import { describe, expect, it } from "vitest";
import { RateLimitedError, createMemoryRateLimitStore, enforceRateLimit } from "@/core";

const policy = { name: "test", limit: 2, windowSeconds: 60 };
const base = Date.parse("2026-09-14T10:00:00.000Z");

describe("rate limiter", () => {
  it("allows requests up to the limit and reports remaining", async () => {
    const store = createMemoryRateLimitStore();

    const first = await enforceRateLimit(store, policy, "acct-1", base);
    const second = await enforceRateLimit(store, policy, "acct-1", base);

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.remaining).toBe(0);
  });

  it("throws a 429-style error with Retry-After once exceeded", async () => {
    const store = createMemoryRateLimitStore();
    await enforceRateLimit(store, policy, "acct-1", base);
    await enforceRateLimit(store, policy, "acct-1", base);

    const error = await enforceRateLimit(store, policy, "acct-1", base).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({ code: "rate_limited", status: 429 });
    expect((error as RateLimitedError).retryAfter).toBeGreaterThan(0);
  });

  it("isolates keys from one another", async () => {
    const store = createMemoryRateLimitStore();
    await enforceRateLimit(store, policy, "acct-1", base);
    await enforceRateLimit(store, policy, "acct-1", base);

    await expect(enforceRateLimit(store, policy, "acct-2", base)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("resets in the next window", async () => {
    const store = createMemoryRateLimitStore();
    await enforceRateLimit(store, policy, "acct-1", base);
    await enforceRateLimit(store, policy, "acct-1", base);

    const nextWindow = base + 60_000;
    await expect(enforceRateLimit(store, policy, "acct-1", nextWindow)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });
});
