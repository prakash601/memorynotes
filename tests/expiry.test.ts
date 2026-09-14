import { describe, expect, it } from "vitest";
import { defaultExpiry, isExpired, isShareExpiryOption, resolveExpiry } from "@/core";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("share expiry", () => {
  it("resolves each option to the expected instant", () => {
    expect(resolveExpiry("1h", NOW)?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(resolveExpiry("24h", NOW)?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(resolveExpiry("7d", NOW)?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(resolveExpiry("30d", NOW)?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(resolveExpiry("90d", NOW)?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(resolveExpiry("never", NOW)).toBeNull();
  });

  it("defaults to 30 days", () => {
    expect(defaultExpiry(NOW).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("recognises valid options", () => {
    expect(isShareExpiryOption("30d")).toBe(true);
    expect(isShareExpiryOption("never")).toBe(true);
    expect(isShareExpiryOption("5m")).toBe(false);
    expect(isShareExpiryOption(undefined)).toBe(false);
  });

  it("treats null as never expiring", () => {
    expect(isExpired(null, NOW)).toBe(false);
  });

  it("detects expiry at and after the boundary", () => {
    expect(isExpired(new Date("2025-12-31T23:59:59Z"), NOW)).toBe(true);
    expect(isExpired(NOW, NOW)).toBe(true);
    expect(isExpired(new Date("2026-01-01T00:00:01Z"), NOW)).toBe(false);
  });
});
