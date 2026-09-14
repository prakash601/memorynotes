import { NextResponse } from "next/server";
import { API_SCOPES } from "@/core";
import { getEnv } from "@/env";

export const dynamic = "force-dynamic";

/** RFC 8414 authorization server metadata for MCP clients. */
export async function GET() {
  const app = getEnv().APP_URL.replace(/\/$/, "");
  return NextResponse.json({
    issuer: app,
    authorization_endpoint: `${app}/api/oauth/authorize`,
    token_endpoint: `${app}/api/oauth/token`,
    registration_endpoint: `${app}/api/oauth/register`,
    revocation_endpoint: `${app}/api/oauth/revoke`,
    scopes_supported: [...API_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  });
}
