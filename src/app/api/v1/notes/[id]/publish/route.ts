import { NextResponse } from "next/server";
import { publishNote } from "@/core";
import { getDb } from "@/db";
import { applyRateLimitHeaders, assertCsrf, problemResponse, readJsonBody } from "@/lib/http";
import { limit } from "@/lib/rate-limit";
import { serializeVersionSummary } from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface PublishBody {
  message?: string;
  base_revision?: number;
  share_token?: string;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const state = await limit("publish_account", user.id);
    const { id } = await context.params;
    const body = await readJsonBody<PublishBody>(request);

    const version = await publishNote(getDb(), {
      noteId: id,
      userId: user.id,
      shareToken: body.share_token,
      message: body.message ?? null,
      baseRevision: body.base_revision,
    });

    return applyRateLimitHeaders(
      NextResponse.json({ published_version: serializeVersionSummary(version) }, { status: 201 }),
      state,
    );
  } catch (error) {
    return problemResponse(error);
  }
}
