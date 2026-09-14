import { describe, expect, it } from "vitest";
import { MAX_CONTENT_BYTES, MAX_TITLE_LENGTH, assertContentSize, normalizeTitle } from "@/core";

describe("validation", () => {
  it("trims titles", () => {
    expect(normalizeTitle("  hello  ")).toBe("hello");
    expect(normalizeTitle(undefined)).toBe("");
  });

  it("rejects an over-long title", () => {
    expect(() => normalizeTitle("x".repeat(MAX_TITLE_LENGTH + 1))).toThrowError(
      /500 characters or fewer/,
    );
  });

  it("accepts content at the limit", () => {
    expect(() => assertContentSize("x".repeat(MAX_CONTENT_BYTES))).not.toThrow();
  });

  it("rejects content over the limit", () => {
    expect(() => assertContentSize("x".repeat(MAX_CONTENT_BYTES + 1))).toThrowError(
      /exceeds the maximum size/,
    );
  });
});
