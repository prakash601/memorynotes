import { NextResponse } from "next/server";
import { getNoteView, setVisibility, softDeleteNote, updateDraft } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { applyRateLimitHeaders, assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";
import { limit } from "@/lib/rate-limit";
import {
  serializeDraft,
  serializeNote,
  serializeShare,
  serializeVersionSummary,
} from "@/lib/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:read");
    const { id } = await context.params;
    const view = await getNoteView(getDb(), id, principal.userId);

    return NextResponse.json({
      ...serializeNote(view.note),
      draft: view.draft ? serializeDraft(view.draft) : null,
      share: view.share ? serializeShare(view.share, null) : null,
      published_version: view.publishedVersion
        ? serializeVersionSummary(view.publishedVersion)
        : null,
    });
  } catch (error) {
    return problemResponse(error);
  }
}

interface PatchBody {
  title?: string;
  content?: string;
  base_revision?: number;
  visibility?: string;
  share_token?: string;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;

    const text = await request.text();
    const body = parseJsonBody<PatchBody>(text);
    const idempotency = await beginIdempotency(request, principal, text);
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const state = await limit("api_account_minute", principal.userId);
    const db = getDb();

    let visibility: string | undefined;
    if (body.visibility !== undefined) {
      const note = await setVisibility(db, {
        noteId: id,
        ownerId: principal.userId,
        visibility: body.visibility,
      });
      visibility = note.visibility;
    }

    let draft = null;
    if (body.title !== undefined || body.content !== undefined) {
      if (body.base_revision === undefined) {
        return NextResponse.json(
          {
            type: "about:blank",
            title: "Validation failed",
            status: 422,
            detail: "base_revision is required when changing title or content",
            code: "validation",
          },
          { status: 422 },
        );
      }
      draft = await updateDraft(db, {
        noteId: id,
        userId: principal.userId,
        shareToken: body.share_token,
        title: body.title,
        content: body.content,
        baseRevision: body.base_revision,
      });
    }

    const response = NextResponse.json({
      id,
      visibility: visibility ?? null,
      draft: draft ? serializeDraft(draft) : null,
    });
    return idempotency.complete(applyRateLimitHeaders(response, state));
  } catch (error) {
    return problemResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:delete");
    assertCsrf(request);
    const { id } = await context.params;

    const idempotency = await beginIdempotency(request, principal, "");
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const state = await limit("api_account_minute", principal.userId);
    const note = await softDeleteNote(getDb(), { noteId: id, ownerId: principal.userId });

    const response = NextResponse.json({ id: note.id, deleted_at: note.deletedAt });
    return idempotency.complete(applyRateLimitHeaders(response, state));
  } catch (error) {
    return problemResponse(error);
  }
}
