import { NextResponse } from "next/server";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, passesCsrfCheck } from "@/lib/csrf";
import {
  ForbiddenError,
  RateLimitedError,
  ValidationError,
  isDomainError,
  rateLimitHeaders,
  type DomainErrorCode,
  type RateLimitState,
} from "@/core";
import { getEnv } from "@/env";

const ERROR_TITLES: Record<DomainErrorCode, string> = {
  unauthorized: "Authentication required",
  forbidden: "Not permitted",
  not_found: "Not found",
  gone: "Gone",
  conflict_revision: "Revision conflict",
  lease_held: "Lease held",
  lease_expired: "Lease expired",
  validation: "Validation failed",
  content_too_large: "Content too large",
  moderation_blocked: "Blocked by moderation",
  rate_limited: "Rate limited",
  email_not_verified: "Email not verified",
};

/** RFC 9457 problem+json. The `code` field is the stable machine identifier. */
export function problemResponse(error: unknown): NextResponse {
  const base = getEnv().APP_URL.replace(/\/$/, "");

  if (isDomainError(error)) {
    const headers: Record<string, string> = {
      "content-type": "application/problem+json",
    };
    if (error instanceof RateLimitedError) {
      headers["retry-after"] = String(error.retryAfter);
    }
    return NextResponse.json(
      {
        type: `${base}/errors/${error.code}`,
        title: ERROR_TITLES[error.code],
        status: error.status,
        detail: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { errors: error.details }),
      },
      { status: error.status, headers },
    );
  }

  console.error("Unhandled API error:", error);
  return NextResponse.json(
    {
      type: `${base}/errors/internal`,
      title: "Internal error",
      status: 500,
      detail: "Something went wrong",
      code: "internal",
    },
    { status: 500, headers: { "content-type": "application/problem+json" } },
  );
}

export function hasBearerToken(request: Request): boolean {
  const header = request.headers.get("authorization");
  return Boolean(header && header.toLowerCase().startsWith("bearer "));
}

/** Copies the doc 09 rate-limit headers onto a successful response. */
export function applyRateLimitHeaders(response: NextResponse, state: RateLimitState): NextResponse {
  for (const [key, value] of Object.entries(rateLimitHeaders(state))) {
    response.headers.set(key, value);
  }
  return response;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return header.slice(7).trim();
}

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return undefined;
}

/**
 * Cookie-authenticated writes must echo the CSRF cookie. Bearer-token requests
 * are exempt because they do not ride on ambient credentials.
 */
export function assertCsrf(request: Request): void {
  const isBearer = hasBearerToken(request);
  const ok = passesCsrfCheck(
    {
      method: request.method,
      headerToken: request.headers.get(CSRF_HEADER_NAME),
      cookieToken: readCookie(request.headers.get("cookie"), CSRF_COOKIE_NAME),
    },
    isBearer,
  );

  if (!ok) {
    throw new ForbiddenError("Invalid or missing CSRF token");
  }
}

export function parseJsonBody<T = Record<string, unknown>>(text: string): T {
  if (!text.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ValidationError("Request body is not valid JSON");
  }
}

export async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  return parseJsonBody<T>(await request.text());
}
