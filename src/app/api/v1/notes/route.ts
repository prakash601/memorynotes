import { NextResponse } from "next/server";
import { createNote, listNotesPage, type ShareExpiryOption } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { applyRateLimitHeaders, assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";
import { observed } from "@/lib/observability";
import { limit } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import { serializeDraft, serializeNote, serializeShare } from "@/lib/serializers";
import { buildShareUrl } from "@/lib/share-url";

export const dynamic = "force-dynamic";

interface CreateNoteBody {
  title?: string;
  content?: string;
  visibility?: string;
  expires_in?: ShareExpiryOption;
}

async function handlePost(request: Request) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);

    const text = await request.text();
    const body = parseJsonBody<CreateNoteBody>(text);
    const idempotency = await beginIdempotency(request, principal, text);
    if (idempotency.replay) {
      return idempotency.replay;
    }

    // Doc 06: 50 creates/day/account and 200/day/IP.
    const accountState = await limit("note_create_account", principal.userId);
    const ipState = await limit("note_create_ip", hashIp(clientIp(request)));
    const state = accountState.remaining <= ipState.remaining ? accountState : ipState;

    const { note, draft, share, rawToken } = await createNote(getDb(), {
      ownerId: principal.userId,
      title: body.title,
      content: body.content,
      visibility: body.visibility,
      expiresIn: body.expires_in,
    });

    const response = NextResponse.json(
      {
        ...serializeNote(note),
        draft: serializeDraft(draft),
        share: serializeShare(share, rawToken),
        published_version: null,
      },
      { status: 201 },
    );

    return idempotency.complete(applyRateLimitHeaders(response, state));
  } catch (error) {
    return problemResponse(error);
  }
}

async function handleGet(request: Request) {
  try {
    const principal = await authenticate(request, "notes:read");
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const favoriteParam = url.searchParams.get("favorite") ?? url.searchParams.get("favorite_only");
    const page = await listNotesPage(getDb(), principal.userId, {
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: url.searchParams.get("cursor"),
      q: url.searchParams.get("q"),
      tag: url.searchParams.get("tag"),
      favoriteOnly: favoriteParam === "true" || favoriteParam === "1",
    });

    return NextResponse.json({
      data: page.data.map((item) => ({
        id: item.id,
        title: item.title,
        visibility: item.visibility,
        revision: item.revision,
        is_favorite: item.isFavorite,
        is_pinned: item.isPinned,
        tags: item.tags,
        updated_at: item.updatedAt,
        published_version_number: item.publishedVersionNumber,
        share:
          item.share && item.share.rawToken
            ? {
                url: buildShareUrl(item.share.rawToken),
                access: item.share.access,
                prefix: item.share.prefix,
                expires_at: item.share.expiresAt,
              }
            : null,
      })),
      next_cursor: page.nextCursor,
    });
  } catch (error) {
    return problemResponse(error);
  }
}

export const POST = observed("notes.create", handlePost);
export const GET = observed("notes.list", handleGet);
