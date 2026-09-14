import { randomBytes, timingSafeEqual } from "node:crypto";

export const CSRF_COOKIE_NAME = "mn_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_BYTES = 32;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Issues a fresh double-submit token. */
export function createCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
}

/** Constant-time comparison of the header token and the cookie token. */
export function csrfTokensMatch(
  headerToken: string | null | undefined,
  cookieToken: string | null | undefined,
): boolean {
  if (!headerToken || !cookieToken) {
    return false;
  }

  const header = Buffer.from(headerToken);
  const cookie = Buffer.from(cookieToken);
  if (header.length !== cookie.length) {
    return false;
  }

  return timingSafeEqual(header, cookie);
}

/** State-changing methods require a CSRF check. */
export function requiresCsrfCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export interface CsrfCheckInput {
  method: string;
  headerToken: string | null | undefined;
  cookieToken: string | null | undefined;
}

/**
 * Single entry point used by route handlers and server actions. Bearer-token
 * requests are exempt: they do not ride on ambient cookie credentials, so they
 * are not CSRF-able.
 */
export function passesCsrfCheck(input: CsrfCheckInput, isBearerAuth: boolean): boolean {
  if (isBearerAuth || !requiresCsrfCheck(input.method)) {
    return true;
  }
  return csrfTokensMatch(input.headerToken, input.cookieToken);
}
