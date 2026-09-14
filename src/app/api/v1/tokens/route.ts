import { NextResponse } from "next/server";
import { API_SCOPES, createApiToken, listApiTokens } from "@/core";
import { getDb } from "@/db";
import { ValidationError } from "@/core";
import { assertCsrf, problemResponse, readJsonBody } from "@/lib/http";
import { serializeApiToken } from "@/lib/serializers";
import { requireSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface CreateTokenBody {
  name?: string;
  scopes?: string[];
  /** Optional lifetime in days. Absent means the token does not expire. */
  expires_in_days?: number;
}

/** Token management is session-only: a token cannot mint or revoke tokens. */
export async function GET() {
  try {
    const user = await requireSessionUser();
    const tokens = await listApiTokens(getDb(), user.id);
    return NextResponse.json({ data: tokens.map(serializeApiToken), next_cursor: null });
  } catch (error) {
    return problemResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    assertCsrf(request);
    const body = await readJsonBody<CreateTokenBody>(request);

    if (body.scopes) {
      for (const scope of body.scopes) {
        if (!(API_SCOPES as readonly string[]).includes(scope)) {
          throw new ValidationError(`Unknown scope: ${scope}`);
        }
      }
    }

    const expiresAt =
      body.expires_in_days && body.expires_in_days > 0
        ? new Date(Date.now() + body.expires_in_days * 24 * 60 * 60 * 1_000)
        : null;

    const { token, rawToken } = await createApiToken(getDb(), {
      userId: user.id,
      name: body.name ?? "",
      scopes: body.scopes,
      expiresAt,
    });

    return NextResponse.json(
      { token: serializeApiToken(token), secret: rawToken },
      { status: 201 },
    );
  } catch (error) {
    return problemResponse(error);
  }
}
