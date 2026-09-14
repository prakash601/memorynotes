import { NextResponse } from "next/server";
import { publishNote } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { applyRateLimitHeaders, assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";
import { limit } from "@/lib/rate-limit";
import { serializeVersionSummary } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface PublishBody {
  message?: string;
  base_revision?: number;
  share_token?: string;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:publish");
    assertCsrf(request);
    const { id } = await context.params;

    const text = await request.text();
    const body = parseJsonBody<PublishBody>(text);
    const idempotency = await beginIdempotency(request, principal, text);
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const state = await limit("publish_account", principal.userId);
    const version = await publishNote(getDb(), {
      noteId: id,
      userId: principal.userId,
      shareToken: body.share_token,
      message: body.message ?? null,
      baseRevision: body.base_revision,
    });

    const response = NextResponse.json(
      { published_version: serializeVersionSummary(version) },
      { status: 201 },
    );
    return idempotency.complete(applyRateLimitHeaders(response, state));
  } catch (error) {
    return problemResponse(error);
  }
}
