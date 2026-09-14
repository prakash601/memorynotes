import { NextResponse } from "next/server";
import { assertCanEdit, heartbeatLease } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface HeartbeatBody {
  lease_token?: string;
  ttl_seconds?: number;
  share_token?: string;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;
    const body = parseJsonBody<HeartbeatBody>(await request.text());

    const db = getDb();
    await assertCanEdit(db, {
      noteId: id,
      userId: principal.userId,
      shareToken: body.share_token,
    });

    const lease = await heartbeatLease(db, {
      noteId: id,
      leaseToken: body.lease_token ?? "",
      ttlSeconds: body.ttl_seconds,
    });

    return NextResponse.json({ expires_at: lease.expiresAt });
  } catch (error) {
    return problemResponse(error);
  }
}
