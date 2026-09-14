"use server";

import { redirect } from "next/navigation";
import {
  buildRedirect,
  grantConsent,
  issueAuthorizationCode,
  validateAuthorizationRequest,
} from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";
import { authorizeParamsFromForm } from "@/lib/oauth";

/** Approve: record consent, then redirect back with an authorization code. */
export async function approveConsentAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  const db = getDb();
  const validation = await validateAuthorizationRequest(db, authorizeParamsFromForm(formData));

  if (!validation.ok) {
    redirect("/oauth/consent?error=invalid_request");
  }
  const { client, redirectUri, scopes, state, codeChallenge } = validation.request;

  await grantConsent(db, { userId: user.id, clientId: client.id, scopes });
  const code = await issueAuthorizationCode(db, {
    clientId: client.id,
    userId: user.id,
    redirectUri,
    scopes,
    codeChallenge,
  });
  redirect(buildRedirect(redirectUri, { code, state }));
}

export async function denyConsentAction(formData: FormData): Promise<void> {
  await requireUserOrRedirect();
  const validation = await validateAuthorizationRequest(getDb(), authorizeParamsFromForm(formData));

  if (!validation.ok) {
    redirect("/oauth/consent?error=invalid_request");
  }
  redirect(
    buildRedirect(validation.request.redirectUri, {
      error: "access_denied",
      state: validation.request.state,
    }),
  );
}
