import { exchangeAuthorizationCode, exchangeRefreshToken, type IssuedTokens } from "@/core";
import { getDb } from "@/db";
import { clientIp, hashIp } from "@/lib/request";
import { limit } from "@/lib/rate-limit";
import { oauthError, oauthErrorFrom, oauthJson, readOAuthParams } from "@/lib/oauth";

export const dynamic = "force-dynamic";

function tokenResponse(tokens: IssuedTokens) {
  return oauthJson({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: Math.floor((tokens.accessExpiresAt.getTime() - Date.now()) / 1_000),
    refresh_token: tokens.refreshToken,
    scope: tokens.token.scope,
  });
}

/** OAuth 2.1 token endpoint: authorization_code with PKCE, and refresh_token. */
export async function POST(request: Request) {
  try {
    const params = await readOAuthParams(request);
    const clientId = params.get("client_id") ?? "";
    await limit("oauth_token_minute", clientId || hashIp(clientIp(request)));

    const grantType = params.get("grant_type");

    if (grantType === "authorization_code") {
      const code = params.get("code") ?? "";
      const redirectUri = params.get("redirect_uri") ?? "";
      const codeVerifier = params.get("code_verifier") ?? "";
      if (!code || !clientId || !redirectUri || !codeVerifier) {
        return oauthError(
          "invalid_request",
          "code, client_id, redirect_uri, and code_verifier are required",
        );
      }

      const tokens = await exchangeAuthorizationCode(getDb(), {
        code,
        clientId,
        redirectUri,
        codeVerifier,
      });
      return tokenResponse(tokens);
    }

    if (grantType === "refresh_token") {
      const refreshToken = params.get("refresh_token") ?? "";
      if (!refreshToken || !clientId) {
        return oauthError("invalid_request", "refresh_token and client_id are required");
      }
      const tokens = await exchangeRefreshToken(getDb(), { refreshToken, clientId });
      return tokenResponse(tokens);
    }

    return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType ?? "(none)"}`);
  } catch (error) {
    return oauthErrorFrom(error);
  }
}
