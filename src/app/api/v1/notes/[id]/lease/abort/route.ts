import { NextResponse } from "next/server";
import { abortLease, assertCanEdit } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface AbortBody {
  lease_token?: string;
  share_token?: string;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;
    const body = parseJsonBody<AbortBody>(await request.text());

    const db = getDb();
    await assertCanEdit(db, {
      noteId: id,
      userId: principal.userId,
      shareToken: body.share_token,
    });

    await abortLease(db, { noteId: id, leaseToken: body.lease_token ?? "" });
    return NextResponse.json({ released: true });
  } catch (error) {
    return problemResponse(error);
  }
}
