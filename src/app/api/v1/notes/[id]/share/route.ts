import { NextResponse } from "next/server";
import {
  getOrCreateShare,
  getShareView,
  revokeShare,
  setShareMaxViews,
  setSharePassword,
  updateShare,
  type ShareExpiryOption,
} from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";
import { serializeShare } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface ShareBody {
  access?: string;
  expires_in?: ShareExpiryOption;
  /** Set a link password; null removes it. Undefined leaves it unchanged. */
  password?: string | null;
  /** Set a view limit (1 = view-once); null removes it. */
  max_views?: number | null;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:share");
    const { id } = await context.params;
    const view = await getShareView(getDb(), id, principal.userId);
    return NextResponse.json({ share: view });
  } catch (error) {
    return problemResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:share");
    assertCsrf(request);
    const { id } = await context.params;

    const text = await request.text();
    const body = parseJsonBody<ShareBody>(text);
    const idempotency = await beginIdempotency(request, principal, text);
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const { share, rawToken } = await getOrCreateShare(getDb(), {
      noteId: id,
      ownerId: principal.userId,
      expiresIn: body.expires_in,
    });

    const response = NextResponse.json({ share: serializeShare(share, rawToken) });
    return idempotency.complete(response);
  } catch (error) {
    return problemResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:share");
    assertCsrf(request);
    const { id } = await context.params;

    const text = await request.text();
    const body = parseJsonBody<ShareBody>(text);
    const idempotency = await beginIdempotency(request, principal, text);
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const db = getDb();
    if (body.access !== undefined || body.expires_in !== undefined) {
      await updateShare(db, {
        noteId: id,
        ownerId: principal.userId,
        access: body.access,
        expiresIn: body.expires_in,
      });
    }

    if (body.password !== undefined) {
      await setSharePassword(db, {
        noteId: id,
        ownerId: principal.userId,
        password: body.password,
      });
    }
    if (body.max_views !== undefined) {
      await setShareMaxViews(db, {
        noteId: id,
        ownerId: principal.userId,
        maxViews: body.max_views,
      });
    }

    const view = await getShareView(db, id, principal.userId);
    const response = NextResponse.json({ share: view });
    return idempotency.complete(response);
  } catch (error) {
    return problemResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:share");
    assertCsrf(request);
    const { id } = await context.params;

    const idempotency = await beginIdempotency(request, principal, "");
    if (idempotency.replay) {
      return idempotency.replay;
    }

    await revokeShare(getDb(), { noteId: id, ownerId: principal.userId });
    return idempotency.complete(NextResponse.json({ revoked: true }));
  } catch (error) {
    return problemResponse(error);
  }
}
