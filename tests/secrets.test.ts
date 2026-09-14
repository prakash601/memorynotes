import { afterEach, describe, expect, it } from "vitest";
import { decryptShareToken, decryptToken, encryptToken, primaryShareSecret } from "@/core";
import { resetEnvCache } from "@/env";

const original = process.env.SHARE_TOKEN_SECRETS;

afterEach(() => {
  if (original === undefined) {
    delete process.env.SHARE_TOKEN_SECRETS;
  } else {
    process.env.SHARE_TOKEN_SECRETS = original;
  }
  resetEnvCache();
});

describe("share-token secret rotation (S13)", () => {
  it("falls back to AUTH_SECRET when no rotation keys are set", () => {
    delete process.env.SHARE_TOKEN_SECRETS;
    resetEnvCache();
    expect(primaryShareSecret()).toBe(process.env.AUTH_SECRET);
  });

  it("decrypts a link encrypted with the previous key after a rotation", () => {
    process.env.SHARE_TOKEN_SECRETS = "old-key";
    resetEnvCache();
    const ciphertext = encryptToken("raw-share-token", primaryShareSecret());

    // Rotate: new key first, old key retained for decryption.
    process.env.SHARE_TOKEN_SECRETS = "new-key,old-key";
    resetEnvCache();

    expect(primaryShareSecret()).toBe("new-key");
    expect(decryptShareToken(ciphertext)).toBe("raw-share-token");

    // New writes use the new key only.
    const fresh = encryptToken("another-token", primaryShareSecret());
    expect(decryptToken(fresh, "new-key")).toBe("another-token");
    expect(decryptToken(fresh, "old-key")).toBeNull();
  });

  it("tries each configured key until one works", () => {
    process.env.SHARE_TOKEN_SECRETS = "a,b,c";
    resetEnvCache();
    const ciphertext = encryptToken("value", "b");
    expect(decryptShareToken(ciphertext)).toBe("value");
  });
});
