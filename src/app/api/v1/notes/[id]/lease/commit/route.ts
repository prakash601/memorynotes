import { NextResponse } from "next/server";
import { assertCanEdit, commitLease, type LeaseCommitMode } from "@/core";
import { getDb } from "@/db";
import { authenticate, requireScope } from "@/lib/auth";
import { assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";
import { serializeVersionSummary } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface CommitBody {
  lease_token?: string;
  mode?: LeaseCommitMode;
  title?: string;
  content?: string;
  message?: string;
  share_token?: string;
}

/** Apply staged content, release the lease, and optionally publish (doc 09). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;

    const text = await request.text();
    const body = parseJsonBody<CommitBody>(text);
    const idempotency = await beginIdempotency(request, principal, text);
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const mode: LeaseCommitMode = body.mode ?? "stage";
    if (mode === "publish") {
      requireScope(principal, "notes:publish");
    }

    const db = getDb();
    await assertCanEdit(db, {
      noteId: id,
      userId: principal.userId,
      shareToken: body.share_token,
    });

    const result = await commitLease(db, {
      noteId: id,
      leaseToken: body.lease_token ?? "",
      mode,
      title: body.title,
      content: body.content,
      message: body.message ?? null,
    });

    const response = NextResponse.json({
      revision: result.revision,
      published_version: result.version ? serializeVersionSummary(result.version) : null,
    });
    return idempotency.complete(response);
  } catch (error) {
    return problemResponse(error);
  }
}
