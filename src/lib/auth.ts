import { assertScope, resolveApiToken, type ApiScope } from "@/core";
import { getDb } from "@/db";
import { ForbiddenError, UnauthorizedError } from "@/core";
import { bearerToken } from "@/lib/http";
import { limit } from "@/lib/rate-limit";

export interface Principal {
  userId: string;
  email: string | null;
  via: "session" | "token";
  tokenId: string | null;
  scopes: readonly string[];
}

/**
 * Resolves the caller from a personal API token (Bearer) or the session cookie,
 * then applies the doc 09 API rate limits. A required scope is enforced for
 * token callers; a browser session is the account owner and has every scope.
 */
export async function authenticate(request: Request, scope?: ApiScope): Promise<Principal> {
  const rawToken = bearerToken(request);

  if (rawToken) {
    const resolved = await resolveApiToken(getDb(), rawToken);
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
      scopes: resolved.token.scopes,
    };
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
    scopes: [],
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
