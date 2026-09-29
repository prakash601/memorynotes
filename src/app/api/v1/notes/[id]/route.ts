import { NextResponse } from "next/server";
import {
  getNoteView,
  hardDeleteNote,
  listNoteTags,
  setFavorite,
  setNoteFolder,
  setNoteTags,
  setPinned,
  setVisibility,
  softDeleteNote,
  updateDraft,
} from "@/core";
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
    const tags =
      view.note.ownerId === principal.userId
        ? await listNoteTags(getDb(), id, principal.userId)
        : [];

    return NextResponse.json({
      ...serializeNote(view.note),
      tags,
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
  favorite?: boolean;
  pinned?: boolean;
  tags?: string[];
  folder_id?: string | null;
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

    if (body.favorite !== undefined) {
      await setFavorite(db, {
        noteId: id,
        ownerId: principal.userId,
        favorite: body.favorite === true,
      });
    }
    if (body.pinned !== undefined) {
      await setPinned(db, { noteId: id, ownerId: principal.userId, pinned: body.pinned === true });
    }

    let tags: string[] | null = null;
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) {
        return NextResponse.json(
          {
            type: "about:blank",
            title: "Validation failed",
            status: 422,
            detail: "tags must be an array of strings",
            code: "validation",
          },
          { status: 422 },
        );
      }
      tags = await setNoteTags(db, { noteId: id, ownerId: principal.userId, tags: body.tags });
    }

    let folderId: string | null | undefined;
    if (body.folder_id !== undefined) {
      const updated = await setNoteFolder(db, {
        noteId: id,
        ownerId: principal.userId,
        folderId: body.folder_id,
      });
      folderId = updated.folderId;
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
      tags,
      folder_id: folderId ?? null,
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

    // Permanent delete is a separate, confirmed path: only trash contents can
    // be hard-deleted, and the caller must say so twice in one body.
    const text = await request.text();
    let permanent = false;
    if (text.trim()) {
      const body = parseJsonBody<{ permanent?: boolean; confirm?: boolean }>(text);
      permanent = body.permanent === true && body.confirm === true;
    }

    const idempotency = await beginIdempotency(request, principal, text);
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const state = await limit("api_account_minute", principal.userId);

    if (permanent) {
      const deleted = await hardDeleteNote(getDb(), { noteId: id, ownerId: principal.userId });
      const response = NextResponse.json({ id: deleted.id, permanently_deleted: true });
      return idempotency.complete(applyRateLimitHeaders(response, state));
    }

    const note = await softDeleteNote(getDb(), { noteId: id, ownerId: principal.userId });

    const response = NextResponse.json({ id: note.id, deleted_at: note.deletedAt });
    return idempotency.complete(applyRateLimitHeaders(response, state));
  } catch (error) {
    return problemResponse(error);
  }
}
