import { NextResponse } from "next/server";
import {
  getOwnedNote,
  setVisibility,
  softDeleteNote,
  updateDraft,
  type ShareExpiryOption,
} from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse, readJsonBody } from "@/lib/http";
import {
  serializeDraft,
  serializeNote,
  serializeShare,
  serializeVersionSummary,
} from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const view = await getOwnedNote(getDb(), id, user.id);

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
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id } = await context.params;
    const body = await readJsonBody<PatchBody>(request);
    const db = getDb();

    let visibility: string | undefined;
    if (body.visibility !== undefined) {
      const note = await setVisibility(db, {
        noteId: id,
        ownerId: user.id,
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
        userId: user.id,
        title: body.title,
        content: body.content,
        baseRevision: body.base_revision,
      });
    }

    return NextResponse.json({
      id,
      visibility: visibility ?? null,
      draft: draft ? serializeDraft(draft) : null,
    });
  } catch (error) {
    return problemResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id } = await context.params;
    const note = await softDeleteNote(getDb(), { noteId: id, ownerId: user.id });

    return NextResponse.json({ id: note.id, deleted_at: note.deletedAt });
  } catch (error) {
    return problemResponse(error);
  }
}

export type { ShareExpiryOption };
