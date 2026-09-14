import { assertScope, resolveApiToken, resolveOAuthAccessToken, type ApiScope } from "@/core";
import { getDb } from "@/db";
import { ForbiddenError, UnauthorizedError } from "@/core";
import { bearerToken } from "@/lib/http";
import { limit } from "@/lib/rate-limit";

export interface Principal {
  userId: string;
  email: string | null;
  via: "session" | "token" | "oauth";
  /** Set for personal API tokens and OAuth access tokens. */
  tokenId: string | null;
  /** Set for OAuth access tokens. */
  clientId: string | null;
  scopes: readonly string[];
}

/**
 * Resolves the caller from a personal API token, an OAuth 2.1 access token, or
 * the session cookie, then applies the doc 09 API rate limits. A required scope
 * is enforced for token callers; a browser session is the account owner and has
 * every scope.
 */
export async function authenticate(request: Request, scope?: ApiScope): Promise<Principal> {
  const rawToken = bearerToken(request);

  if (rawToken) {
    return authenticateToken(rawToken, scope);
  }

  // Imported lazily: the session path pulls in NextAuth, which must not load
  // for bearer-token (API/CLI) callers.
  const { getCurrentUser } = await import("@/lib/session");
  const viewer = await getCurrentUser();
  if (!viewer) {
    throw new UnauthorizedError();
  }
  await limit("api_account_minute", viewer.id);

  return {
    userId: viewer.id,
    email: viewer.email,
    via: "session",
    tokenId: null,
    clientId: null,
    scopes: [],
  };
}

async function authenticateToken(rawToken: string, scope?: ApiScope): Promise<Principal> {
  const db = getDb();

  if (rawToken.startsWith("mn_")) {
    const resolved = await resolveApiToken(db, rawToken);
    await limit("api_token_minute", resolved.token.id);
    await limit("api_account_minute", resolved.userId);
    if (scope) {
      assertScope(resolved.token, scope);
    }
    return {
      userId: resolved.userId,
      email: resolved.email,
      via: "token",
      tokenId: resolved.token.id,
      clientId: null,
      scopes: resolved.token.scopes,
    };
  }

  const resolved = await resolveOAuthAccessToken(db, rawToken);
  await limit("api_token_minute", resolved.token.id);
  await limit("api_account_minute", resolved.userId);
  if (scope && !resolved.scopes.includes(scope)) {
    throw new ForbiddenError(`This token is missing the ${scope} scope`);
  }
  return {
    userId: resolved.userId,
    email: resolved.email,
    via: "oauth",
    tokenId: resolved.token.id,
    clientId: resolved.token.clientId,
    scopes: resolved.scopes,
  };
}

/**
 * Extra scope check for an action whose scope depends on the request body (a
 * lease commit that publishes). A session always passes.
 */
export function requireScope(principal: Principal, scope: ApiScope): void {
  if (principal.via === "session") {
    return;
  }
  if (!principal.scopes.includes(scope)) {
    throw new ForbiddenError(`This token is missing the ${scope} scope`);
  }
}
