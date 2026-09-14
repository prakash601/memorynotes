import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import {
  oauthAuthorizationCodes,
  oauthClients,
  oauthConsents,
  oauthTokens,
  users,
  type OAuthClient,
  type OAuthToken,
} from "@/db/schema";
import { API_SCOPES, isApiScope, type ApiScope } from "./api-tokens";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "./errors";
import { hashToken } from "./tokens";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTH_CODE_TTL_SECONDS = 10 * 60;

const ACCESS_PREFIX = "oa_";
const REFRESH_PREFIX = "or_";
const CODE_PREFIX = "oc_";
const SECRET_PREFIX = "os_";

function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

/** RFC 7636 S256: base64url(sha256(verifier)), unpadded. */
export function pkceChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function isValidRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "https:") {
      return true;
    }
    return (
      parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function assertScopes(scopes: string[]): asserts scopes is ApiScope[] {
  for (const scope of scopes) {
    if (!isApiScope(scope)) {
      throw new ValidationError(`Unknown scope: ${scope}`);
    }
  }
}

export interface RegisterClientInput {
  clientName: string;
  redirectUris: string[];
  scopes?: string[];
  isDynamic?: boolean;
}

export interface RegisteredClient {
  client: OAuthClient;
  /** Null for public clients that use PKCE without a secret. */
  clientSecret: string | null;
}

/** Dynamic client registration (RFC 7591) and predefined clients share this. */
export async function registerClient(
  db: Database,
  input: RegisterClientInput,
): Promise<RegisteredClient> {
  const clientName = input.clientName.trim();
  if (!clientName) {
    throw new ValidationError("client_name is required");
  }
  if (input.redirectUris.length === 0) {
    throw new ValidationError("At least one redirect_uri is required");
  }
  for (const uri of input.redirectUris) {
    if (!isValidRedirectUri(uri)) {
      throw new ValidationError(`redirect_uri must be https or localhost: ${uri}`);
    }
  }

  const scopes = input.scopes && input.scopes.length > 0 ? input.scopes : [...API_SCOPES];
  assertScopes(scopes);

  const clientId = randomToken("oc_", 16);
  const rawSecret = randomToken(SECRET_PREFIX);
  const [client] = await db
    .insert(oauthClients)
    .values({
      id: clientId,
      clientName,
      clientSecretHash: hashToken(rawSecret),
      redirectUris: input.redirectUris,
      grantTypes: ["authorization_code", "refresh_token"],
      scopes,
      isDynamic: input.isDynamic ?? true,
    })
    .returning();

  return { client, clientSecret: rawSecret };
}

export async function getClient(db: Database, clientId: string): Promise<OAuthClient | null> {
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);
  return client ?? null;
}

export async function requireClient(db: Database, clientId: string): Promise<OAuthClient> {
  const client = await getClient(db, clientId);
  if (!client) {
    throw new NotFoundError("Unknown client");
  }
  return client;
}

export interface AuthorizationRequest {
  client: OAuthClient;
  redirectUri: string;
  scopes: ApiScope[];
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export type AuthorizationValidation =
  | { ok: true; request: AuthorizationRequest }
  | { ok: false; error: string; description: string; redirectUri: string | null };

/**
 * Validates an authorization request. When the redirect URI itself is invalid
 * the result has no redirect target: the caller must show an error page rather
 * than redirect anywhere (this is an open-redirect guard).
 */
export async function validateAuthorizationRequest(
  db: Database,
  params: URLSearchParams,
): Promise<AuthorizationValidation> {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = params.get("response_type") ?? "";
  const state = params.get("state");
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "";

  const client = await getClient(db, clientId);
  if (!client) {
    return {
      ok: false,
      error: "invalid_request",
      description: "Unknown client_id",
      redirectUri: null,
    };
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      error: "invalid_request",
      description: "redirect_uri is not registered for this client",
      redirectUri: null,
    };
  }
  if (responseType !== "code") {
    return {
      ok: false,
      error: "unsupported_response_type",
      description: "Only response_type=code is supported",
      redirectUri,
    };
  }
  if (codeChallengeMethod !== "S256" || !codeChallenge) {
    return {
      ok: false,
      error: "invalid_request",
      description: "PKCE with code_challenge_method=S256 is required",
      redirectUri,
    };
  }

  const requested = (params.get("scope") ?? client.scopes.join(" ")).split(/\s+/).filter(Boolean);
  for (const scope of requested) {
    if (!client.scopes.includes(scope)) {
      return {
        ok: false,
        error: "invalid_scope",
        description: `Scope not granted to this client: ${scope}`,
        redirectUri,
      };
    }
  }
  assertScopes(requested);

  return {
    ok: true,
    request: {
      client,
      redirectUri,
      scopes: requested,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
    },
  };
}

/** Builds the redirect back to the client, with an error or a code. */
export function buildRedirect(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function issueAuthorizationCode(
  db: Database,
  input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge: string;
    now?: Date;
  },
): Promise<string> {
  const now = input.now ?? new Date();
  const rawCode = randomToken(CODE_PREFIX);
  await db.insert(oauthAuthorizationCodes).values({
    codeHash: hashToken(rawCode),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    scope: input.scopes.join(" "),
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_SECONDS * 1_000),
  });
  return rawCode;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  token: OAuthToken;
}

/** Access tokens are short-lived; refresh tokens rotate on every exchange. */
export async function issueTokens(
  db: Database,
  input: {
    clientId: string;
    userId: string;
    scopes: string[];
    sourcePlatform?: string | null;
    now?: Date;
  },
): Promise<IssuedTokens> {
  const now = input.now ?? new Date();
  const accessToken = randomToken(ACCESS_PREFIX);
  const refreshToken = randomToken(REFRESH_PREFIX);
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1_000);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1_000);

  const [token] = await db
    .insert(oauthTokens)
    .values({
      clientId: input.clientId,
      userId: input.userId,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      scope: input.scopes.join(" "),
      sourcePlatform: input.sourcePlatform ?? null,
      accessExpiresAt,
      refreshExpiresAt,
    })
    .returning();

  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, token };
}

export async function exchangeAuthorizationCode(
  db: Database,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    now?: Date;
  },
): Promise<IssuedTokens> {
  const now = input.now ?? new Date();
  const [code] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, hashToken(input.code)))
    .limit(1);

  if (!code || code.consumedAt || code.expiresAt.getTime() <= now.getTime()) {
    throw new UnauthorizedError("Invalid or expired authorization code");
  }
  if (code.clientId !== input.clientId || code.redirectUri !== input.redirectUri) {
    throw new UnauthorizedError("Authorization code does not match the client");
  }
  if (pkceChallengeFromVerifier(input.codeVerifier) !== code.codeChallenge) {
    throw new UnauthorizedError("PKCE verification failed");
  }

  const [claimed] = await db
    .update(oauthAuthorizationCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthAuthorizationCodes.codeHash, code.codeHash),
        isNull(oauthAuthorizationCodes.consumedAt),
      ),
    )
    .returning({ codeHash: oauthAuthorizationCodes.codeHash });
  if (!claimed) {
    // Another exchange won the race.
    throw new UnauthorizedError("Authorization code already used");
  }

  return issueTokens(db, {
    clientId: code.clientId,
    userId: code.userId,
    scopes: code.scope.split(/\s+/).filter(Boolean),
    now,
  });
}

export async function exchangeRefreshToken(
  db: Database,
  input: { refreshToken: string; clientId: string; now?: Date },
): Promise<IssuedTokens> {
  const now = input.now ?? new Date();
  const [existing] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.refreshTokenHash, hashToken(input.refreshToken)))
    .limit(1);

  if (!existing || existing.revokedAt || existing.clientId !== input.clientId) {
    throw new UnauthorizedError("Invalid refresh token");
  }
  if (existing.refreshExpiresAt && existing.refreshExpiresAt.getTime() <= now.getTime()) {
    throw new UnauthorizedError("Refresh token expired");
  }

  // Rotation: the used refresh token is revoked as the new pair is issued.
  await db.update(oauthTokens).set({ revokedAt: now }).where(eq(oauthTokens.id, existing.id));

  return issueTokens(db, {
    clientId: existing.clientId,
    userId: existing.userId,
    scopes: existing.scope.split(/\s+/).filter(Boolean),
    sourcePlatform: existing.sourcePlatform,
    now,
  });
}

/** RFC 7009: revoking an unknown token is still a success. */
export async function revokeOAuthToken(
  db: Database,
  input: { token: string; clientId?: string | null; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const hash = hashToken(input.token);

  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.accessTokenHash, hash))
    .limit(1);
  const [byRefresh] = row
    ? []
    : await db.select().from(oauthTokens).where(eq(oauthTokens.refreshTokenHash, hash)).limit(1);
  const token = row ?? byRefresh;
  if (!token) {
    return;
  }
  if (input.clientId && token.clientId !== input.clientId) {
    throw new ForbiddenError("Token was not issued to this client");
  }
  await db.update(oauthTokens).set({ revokedAt: now }).where(eq(oauthTokens.id, token.id));
}

export interface ResolvedOAuthToken {
  token: OAuthToken;
  userId: string;
  email: string | null;
  scopes: ApiScope[];
}

export async function resolveOAuthAccessToken(
  db: Database,
  rawToken: string,
  now: Date = new Date(),
): Promise<ResolvedOAuthToken> {
  const [row] = await db
    .select({ token: oauthTokens, email: users.email })
    .from(oauthTokens)
    .innerJoin(users, eq(users.id, oauthTokens.userId))
    .where(eq(oauthTokens.accessTokenHash, hashToken(rawToken)))
    .limit(1);

  if (!row) {
    throw new UnauthorizedError("Invalid access token");
  }
  const { token } = row;
  if (token.revokedAt || token.accessExpiresAt.getTime() <= now.getTime()) {
    throw new UnauthorizedError("Invalid access token");
  }

  const scopes = token.scope.split(/\s+/).filter(Boolean);
  assertScopes(scopes);
  return { token, userId: token.userId, email: row.email, scopes };
}

export async function grantConsent(
  db: Database,
  input: { userId: string; clientId: string; scopes: string[]; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .insert(oauthConsents)
    .values({
      userId: input.userId,
      clientId: input.clientId,
      scopes: input.scopes,
      grantedAt: now,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [oauthConsents.userId, oauthConsents.clientId],
      set: { scopes: input.scopes, grantedAt: now, revokedAt: null },
    });
}

export async function getConsent(
  db: Database,
  userId: string,
  clientId: string,
): Promise<{ scopes: string[] } | null> {
  const [consent] = await db
    .select()
    .from(oauthConsents)
    .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)))
    .limit(1);
  if (!consent || consent.revokedAt) {
    return null;
  }
  return { scopes: consent.scopes };
}

export interface ConnectedApp {
  clientId: string;
  clientName: string;
  scopes: string[];
  grantedAt: Date;
}

/** Connected apps shown in settings. */
export async function listConsents(db: Database, userId: string): Promise<ConnectedApp[]> {
  const rows = await db
    .select({
      clientId: oauthConsents.clientId,
      clientName: oauthClients.clientName,
      scopes: oauthConsents.scopes,
      grantedAt: oauthConsents.grantedAt,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthConsents.clientId))
    .where(and(eq(oauthConsents.userId, userId), isNull(oauthConsents.revokedAt)));

  return rows.map((row) => ({
    clientId: row.clientId,
    clientName: row.clientName,
    scopes: row.scopes,
    grantedAt: row.grantedAt,
  }));
}

/** Revoking consent also kills the tokens already issued for that client. */
export async function revokeConsent(
  db: Database,
  input: { userId: string; clientId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(oauthConsents)
    .set({ revokedAt: now })
    .where(and(eq(oauthConsents.userId, input.userId), eq(oauthConsents.clientId, input.clientId)));
  await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(oauthTokens.userId, input.userId),
        eq(oauthTokens.clientId, input.clientId),
        isNull(oauthTokens.revokedAt),
      ),
    );
}
