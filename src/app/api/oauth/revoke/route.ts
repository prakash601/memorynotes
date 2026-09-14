import { revokeOAuthToken } from "@/core";
import { getDb } from "@/db";
import { oauthError, oauthErrorFrom, oauthJson, readOAuthParams } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** RFC 7009 revocation. Revoking an unknown token is still a 200. */
export async function POST(request: Request) {
  try {
    const params = await readOAuthParams(request);
    const token = params.get("token") ?? "";
    if (!token) {
      return oauthError("invalid_request", "token is required");
    }

    await revokeOAuthToken(getDb(), {
      token,
      clientId: params.get("client_id"),
    });
    return oauthJson({});
  } catch (error) {
    return oauthErrorFrom(error);
  }
}
