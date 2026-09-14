import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  grantConsent,
  issueAuthorizationCode,
  listConsents,
  pkceChallengeFromVerifier,
  registerClient,
  resolveOAuthAccessToken,
  revokeConsent,
  revokeOAuthToken,
  validateAuthorizationRequest,
} from "@/core";
import { GET as metadataGet } from "@/app/api/oauth/authorization-server/route";
import { GET as resourceGet } from "@/app/api/oauth/protected-resource/route";
import { POST as registerPost } from "@/app/api/oauth/register/route";
import { POST as tokenPost } from "@/app/api/oauth/token/route";
import { POST as revokePost } from "@/app/api/oauth/revoke/route";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

const REDIRECT_URI = "https://dummy.example/callback";

function verifier(): string {
  return randomBytes(32).toString("base64url");
}

function formRequest(path: string, fields: Record<string, string>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

describeWithDatabase("oauth 2.1", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function registerDummy(name = "Dummy") {
    return registerClient(db, {
      clientName: name,
      redirectUris: [REDIRECT_URI],
      scopes: ["notes:read", "notes:write"],
    });
  }

  it("registers a second client with no code change", async () => {
    const first = await registerDummy("First");
    const second = await registerDummy("Second");

    expect(first.client.id).not.toBe(second.client.id);
    expect(first.clientSecret).toBeTruthy();
    expect(second.client.redirectUris).toEqual([REDIRECT_URI]);
  });

  it("validates authorization requests, including the redirect guard", async () => {
    const { client } = await registerDummy();
    const challenge = pkceChallengeFromVerifier(verifier());

    const ok = await validateAuthorizationRequest(
      db,
      new URLSearchParams({
        client_id: client.id,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "notes:read",
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
    );
    expect(ok.ok).toBe(true);

    const badRedirect = await validateAuthorizationRequest(
      db,
      new URLSearchParams({
        client_id: client.id,
        redirect_uri: "https://evil.example/cb",
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
    );
    expect(badRedirect).toMatchObject({ ok: false, redirectUri: null });

    const noPkce = await validateAuthorizationRequest(
      db,
      new URLSearchParams({
        client_id: client.id,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
      }),
    );
    expect(noPkce).toMatchObject({ ok: false, redirectUri: REDIRECT_URI });
  });

  it("exchanges an authorization code with PKCE, then rotates the refresh token", async () => {
    const { client } = await registerDummy();
    const userId = await createTestUser(sql);
    const codeVerifier = verifier();
    const scopes = ["notes:read", "notes:write"];

    await grantConsent(db, { userId, clientId: client.id, scopes });
    const code = await issueAuthorizationCode(db, {
      clientId: client.id,
      userId,
      redirectUri: REDIRECT_URI,
      scopes,
      codeChallenge: pkceChallengeFromVerifier(codeVerifier),
    });

    await expect(
      exchangeAuthorizationCode(db, {
        code,
        clientId: client.id,
        redirectUri: REDIRECT_URI,
        codeVerifier: "wrong-verifier-wrong-verifier-wrong-verifier",
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });

    const tokens = await exchangeAuthorizationCode(db, {
      code,
      clientId: client.id,
      redirectUri: REDIRECT_URI,
      codeVerifier,
    });
    const resolved = await resolveOAuthAccessToken(db, tokens.accessToken);
    expect(resolved.userId).toBe(userId);
    expect(resolved.scopes).toEqual(scopes);

    // A code is single-use.
    await expect(
      exchangeAuthorizationCode(db, {
        code,
        clientId: client.id,
        redirectUri: REDIRECT_URI,
        codeVerifier,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });

    const rotated = await exchangeRefreshToken(db, {
      refreshToken: tokens.refreshToken,
      clientId: client.id,
    });
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    await expect(
      exchangeRefreshToken(db, { refreshToken: tokens.refreshToken, clientId: client.id }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("revokes a token immediately", async () => {
    const { client } = await registerDummy();
    const userId = await createTestUser(sql);
    const codeVerifier = verifier();
    const code = await issueAuthorizationCode(db, {
      clientId: client.id,
      userId,
      redirectUri: REDIRECT_URI,
      scopes: ["notes:read"],
      codeChallenge: pkceChallengeFromVerifier(codeVerifier),
    });
    const tokens = await exchangeAuthorizationCode(db, {
      code,
      clientId: client.id,
      redirectUri: REDIRECT_URI,
      codeVerifier,
    });

    await revokeOAuthToken(db, { token: tokens.accessToken });
    await expect(resolveOAuthAccessToken(db, tokens.accessToken)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("kills issued tokens when consent is revoked", async () => {
    const { client } = await registerDummy();
    const userId = await createTestUser(sql);
    const codeVerifier = verifier();
    const code = await issueAuthorizationCode(db, {
      clientId: client.id,
      userId,
      redirectUri: REDIRECT_URI,
      scopes: ["notes:read"],
      codeChallenge: pkceChallengeFromVerifier(codeVerifier),
    });
    const tokens = await exchangeAuthorizationCode(db, {
      code,
      clientId: client.id,
      redirectUri: REDIRECT_URI,
      codeVerifier,
    });
    await grantConsent(db, { userId, clientId: client.id, scopes: ["notes:read"] });
    expect(await listConsents(db, userId)).toHaveLength(1);

    await revokeConsent(db, { userId, clientId: client.id });
    await expect(resolveOAuthAccessToken(db, tokens.accessToken)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(await listConsents(db, userId)).toHaveLength(0);
  });

  it("serves discovery metadata", async () => {
    const metadata = (await (await metadataGet()).json()) as {
      authorization_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    expect(metadata.authorization_endpoint).toContain("/api/oauth/authorize");
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);

    const resource = (await (await resourceGet()).json()) as { resource: string };
    expect(resource.resource).toContain("/api/mcp");
  });

  it("registers and exchanges over HTTP", async () => {
    const registered = await registerPost(
      new Request("http://localhost:3000/api/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "HTTP Dummy",
          redirect_uris: [REDIRECT_URI],
          scope: "notes:read notes:write",
        }),
      }),
    );
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };

    const userId = await createTestUser(sql);
    const codeVerifier = verifier();
    const code = await issueAuthorizationCode(db, {
      clientId: client.client_id,
      userId,
      redirectUri: REDIRECT_URI,
      scopes: ["notes:read", "notes:write"],
      codeChallenge: pkceChallengeFromVerifier(codeVerifier),
    });

    const token = await tokenPost(
      formRequest("/api/oauth/token", {
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    );
    expect(token.status).toBe(200);
    const body = (await token.json()) as { access_token: string; refresh_token: string };
    expect(body.access_token).toMatch(/^oa_/);

    const revoked = await revokePost(
      formRequest("/api/oauth/revoke", {
        token: body.access_token,
        client_id: client.client_id,
      }),
    );
    expect(revoked.status).toBe(200);
    await expect(resolveOAuthAccessToken(db, body.access_token)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects an unsupported grant type", async () => {
    const response = await tokenPost(
      formRequest("/api/oauth/token", { grant_type: "password", client_id: "x" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "unsupported_grant_type" });
  });
});
