import { NextResponse } from "next/server";
import {
  buildRedirect,
  getConsent,
  issueAuthorizationCode,
  validateAuthorizationRequest,
} from "@/core";
import { getDb } from "@/db";
import { getEnv } from "@/env";
import { oauthError } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const CONSENT_PARAM_KEYS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
] as const;

/**
 * OAuth 2.1 authorization endpoint (doc 09, ADR-0006). Validates the request,
 * requires a signed-in user, and either issues a code (already consented) or
 * sends the user to the consent screen.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const db = getDb();
  const validation = await validateAuthorizationRequest(db, url.searchParams);

  if (!validation.ok) {
    if (validation.redirectUri) {
      return NextResponse.redirect(
        buildRedirect(validation.redirectUri, {
          error: validation.error,
          error_description: validation.description,
          state: url.searchParams.get("state"),
        }),
        302,
      );
    }
    return oauthError(validation.error, validation.description);
  }

  const authRequest = validation.request;
  const { getCurrentUser } = await import("@/lib/session");
  const viewer = await getCurrentUser();
  const app = getEnv().APP_URL.replace(/\/$/, "");

  if (!viewer) {
    const next = encodeURIComponent(`${url.pathname}${url.search}`);
    return NextResponse.redirect(`${app}/signin?next=${next}`, 302);
  }

  const consent = await getConsent(db, viewer.id, authRequest.client.id);
  const covered = consent && authRequest.scopes.every((scope) => consent.scopes.includes(scope));

  if (covered) {
    const code = await issueAuthorizationCode(db, {
      clientId: authRequest.client.id,
      userId: viewer.id,
      redirectUri: authRequest.redirectUri,
      scopes: authRequest.scopes,
      codeChallenge: authRequest.codeChallenge,
    });
    return NextResponse.redirect(
      buildRedirect(authRequest.redirectUri, { code, state: authRequest.state }),
      302,
    );
  }

  const consentUrl = new URL(`${app}/oauth/consent`);
  for (const key of CONSENT_PARAM_KEYS) {
    const value = url.searchParams.get(key);
    if (value) {
      consentUrl.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(consentUrl.toString(), 302);
}
