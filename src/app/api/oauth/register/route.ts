import { NextResponse } from "next/server";
import { isApiScope, registerClient } from "@/core";
import { getDb } from "@/db";
import { ValidationError } from "@/core";
import { clientIp, hashIp } from "@/lib/request";
import { limit } from "@/lib/rate-limit";
import { oauthErrorFrom } from "@/lib/oauth";

export const dynamic = "force-dynamic";

interface RegisterBody {
  client_name?: string;
  redirect_uris?: string[];
  scope?: string;
  grant_types?: string[];
  token_endpoint_auth_method?: string;
}

/** RFC 7591 dynamic client registration. Registrations are rate limited. */
export async function POST(request: Request) {
  try {
    await limit("oauth_register_hour", hashIp(clientIp(request)));

    let body: RegisterBody;
    try {
      body = (await request.json()) as RegisterBody;
    } catch {
      throw new ValidationError("Request body must be JSON");
    }

    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const scopes = body.scope ? body.scope.split(/\s+/).filter(Boolean) : undefined;
    if (scopes) {
      for (const scope of scopes) {
        if (!isApiScope(scope)) {
          throw new ValidationError(`Unknown scope: ${scope}`);
        }
      }
    }

    const { client, clientSecret } = await registerClient(getDb(), {
      clientName: body.client_name ?? "",
      redirectUris,
      scopes,
      isDynamic: true,
    });

    return NextResponse.json(
      {
        client_id: client.id,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1_000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        response_types: ["code"],
        token_endpoint_auth_method: clientSecret ? "client_secret_post" : "none",
        scope: client.scopes.join(" "),
      },
      { status: 201 },
    );
  } catch (error) {
    return oauthErrorFrom(error);
  }
}
