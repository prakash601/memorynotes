import { NextResponse } from "next/server";
import { API_SCOPES } from "@/core";
import { getEnv } from "@/env";

export const dynamic = "force-dynamic";

/** RFC 9728 protected resource metadata, pointed at by the MCP 401 challenge. */
export async function GET() {
  const app = getEnv().APP_URL.replace(/\/$/, "");
  return NextResponse.json({
    resource: `${app}/api/mcp`,
    authorization_servers: [app],
    scopes_supported: [...API_SCOPES],
    bearer_methods_supported: ["header"],
  });
}
