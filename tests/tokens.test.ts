import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  decryptToken,
  encryptToken,
  generateShareToken,
  hashToken,
  tokenPrefix,
} from "@/core";

describe("share tokens", () => {
  it("generates a 22 character url-safe token", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("generates unique tokens", () => {
    expect(generateShareToken()).not.toBe(generateShareToken());
  });

  it("hashes deterministically and never to the raw value", () => {
    const token = generateShareToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it("derives a display prefix", () => {
    const token = generateShareToken();
    expect(tokenPrefix(token)).toBe(token.slice(0, 8));
  });

  it("round-trips an encrypted token", () => {
    const token = generateShareToken();
    const payload = encryptToken(token, "a-server-secret");
    expect(payload).not.toContain(token);
    expect(decryptToken(payload, "a-server-secret")).toBe(token);
  });

  it("fails to decrypt with the wrong secret instead of throwing", () => {
    const payload = encryptToken(generateShareToken(), "secret-one");
    expect(decryptToken(payload, "secret-two")).toBeNull();
  });

  it("returns null for malformed ciphertext", () => {
    expect(decryptToken("not-a-payload", "secret")).toBeNull();
  });

  it("compares strings in constant time semantics", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
