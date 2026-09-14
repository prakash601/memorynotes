import { NextResponse } from "next/server";
import { assertCanEdit, acquireLease, forceReleaseLease, type LeaseHolderType } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface AcquireBody {
  ttl_seconds?: number;
  holder_type?: LeaseHolderType;
  client_id?: string;
  share_token?: string;
}

/** Acquire the exclusive write lease (ADR-0004). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;

    const text = await request.text();
    const body = parseJsonBody<AcquireBody>(text);
    const idempotency = await beginIdempotency(request, principal, text);
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const db = getDb();
    await assertCanEdit(db, {
      noteId: id,
      userId: principal.userId,
      shareToken: body.share_token,
    });

    const view = await acquireLease(db, {
      noteId: id,
      holderId: principal.userId,
      holderType: body.holder_type ?? "user",
      clientId: body.client_id ?? null,
      ttlSeconds: body.ttl_seconds,
    });

    const response = NextResponse.json({
      lease_token: view.leaseToken,
      base_revision: view.baseRevision,
      expires_at: view.expiresAt,
    });
    return idempotency.complete(response);
  } catch (error) {
    return problemResponse(error);
  }
}

/** Owner force-release (ADR-0004). */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;

    const idempotency = await beginIdempotency(request, principal, "");
    if (idempotency.replay) {
      return idempotency.replay;
    }

    await forceReleaseLease(getDb(), { noteId: id, ownerId: principal.userId });
    return idempotency.complete(NextResponse.json({ released: true }));
  } catch (error) {
    return problemResponse(error);
  }
}
