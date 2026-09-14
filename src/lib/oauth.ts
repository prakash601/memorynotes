import { NextResponse } from "next/server";
import { isDomainError } from "@/core";

/** RFC 6749 error body for the token and authorization endpoints. */
export function oauthError(error: string, description: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store", pragma: "no-cache" } },
  );
}

export function oauthJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store", pragma: "no-cache" },
  });
}

/** Maps a domain error onto the OAuth error vocabulary. */
export function oauthErrorFrom(error: unknown): NextResponse {
  if (isDomainError(error)) {
    switch (error.code) {
      case "unauthorized":
        return oauthError("invalid_grant", error.message);
      case "validation":
        return oauthError("invalid_request", error.message);
      case "not_found":
        return oauthError("invalid_client", error.message);
      case "forbidden":
        return oauthError("unauthorized_client", error.message);
      default:
        return oauthError("server_error", error.message, 500);
    }
  }
  console.error("Unhandled OAuth error:", error);
  return oauthError("server_error", "Something went wrong", 500);
}

/** Accepts form-encoded (spec) or JSON (convenience) token requests. */
export async function readOAuthParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  const text = await request.text();

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed)) {
        params.set(key, String(value));
      }
      return params;
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}

/** The authorization request parameters, shared by the endpoint and consent. */
export const AUTHORIZE_PARAM_KEYS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
] as const;

export function authorizeParamsFromForm(formData: FormData): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of AUTHORIZE_PARAM_KEYS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }
  return params;
}
