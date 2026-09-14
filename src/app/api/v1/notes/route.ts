import { NextResponse } from "next/server";
import { createNote, listNotes, type ShareExpiryOption } from "@/core";
import { getDb } from "@/db";
import { applyRateLimitHeaders, assertCsrf, problemResponse, readJsonBody } from "@/lib/http";
import { limit } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import { serializeDraft, serializeNote, serializeShare } from "@/lib/serializers";
import { buildShareUrl } from "@/lib/share-url";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface CreateNoteBody {
  title?: string;
  content?: string;
  visibility?: string;
  expires_in?: ShareExpiryOption;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    assertCsrf(request);

    // Doc 06: 50 creates/day/account and 200/day/IP.
    const accountState = await limit("note_create_account", user.id);
    const ipState = await limit("note_create_ip", hashIp(clientIp(request)));
    const state = accountState.remaining <= ipState.remaining ? accountState : ipState;

    const body = await readJsonBody<CreateNoteBody>(request);

    const { note, draft, share, rawToken } = await createNote(getDb(), {
      ownerId: user.id,
      title: body.title,
      content: body.content,
      visibility: body.visibility,
      expiresIn: body.expires_in,
    });

    return applyRateLimitHeaders(
      NextResponse.json(
        {
          ...serializeNote(note),
          draft: serializeDraft(draft),
          share: serializeShare(share, rawToken),
          published_version: null,
        },
        { status: 201 },
      ),
      state,
    );
  } catch (error) {
    return problemResponse(error);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const items = await listNotes(getDb(), user.id);

    return NextResponse.json({
      data: items.map((item) => ({
        id: item.id,
        title: item.title,
        visibility: item.visibility,
        revision: item.revision,
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
      next_cursor: null,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
