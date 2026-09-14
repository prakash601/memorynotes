import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "@/env";

/** 16 random bytes, base64url encoded (22 characters). Per doc 03. */
const SHARE_TOKEN_BYTES = 16;
const TOKEN_PREFIX_LENGTH = 8;

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

/** Tokens are only ever stored as a hash; the raw value is shown once. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Short, non-secret prefix used for display in the UI. */
export function tokenPrefix(rawToken: string): string {
  return rawToken.slice(0, TOKEN_PREFIX_LENGTH);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

const IV_BYTES = 12;
const KEY_CONTEXT = "memorynotes:share-token:v1";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`${KEY_CONTEXT}:${secret}`).digest();
}

/**
 * The owner must be able to re-display their own link, but lookups still go
 * through the one-way hash. So the raw token is additionally stored encrypted
 * at rest with a key derived from the server secret. Rotating the server secret
 * breaks display only; links keep working because lookup uses the hash.
 */
export function encryptToken(rawToken: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(rawToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((buffer) => buffer.toString("base64url")).join(".");
}

export function decryptToken(payload: string, secret: string): string | null {
  try {
    const [ivPart, tagPart, dataPart] = payload.split(".");
    if (!ivPart || !tagPart || !dataPart) {
      return null;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}

/** Public read URL for a raw share token, used by API and MCP responses. */
export function shareUrlFromToken(rawToken: string): string {
  const domain = getEnv().SHARE_DOMAIN;
  const base = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
  return `${base.replace(/\/$/, "")}/n/${rawToken}`;
}
