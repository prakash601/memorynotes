import { NextResponse } from "next/server";
import { rotateShare } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";
import { serializeShare } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:share");
    assertCsrf(request);
    const { id } = await context.params;

    const idempotency = await beginIdempotency(request, principal, "");
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const { share, rawToken } = await rotateShare(getDb(), {
      noteId: id,
      ownerId: principal.userId,
    });

    return idempotency.complete(NextResponse.json({ share: serializeShare(share, rawToken) }));
  } catch (error) {
    return problemResponse(error);
  }
}
