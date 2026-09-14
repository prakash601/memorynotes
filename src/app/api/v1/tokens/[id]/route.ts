import { NextResponse } from "next/server";
import { revokeApiToken } from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse } from "@/lib/http";
import { requireSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Revocation takes effect immediately; management is session-only. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    assertCsrf(request);
    const { id } = await context.params;

    await revokeApiToken(getDb(), { tokenId: id, userId: user.id });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return problemResponse(error);
  }
}
