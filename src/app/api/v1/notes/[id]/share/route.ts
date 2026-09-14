import { NextResponse } from "next/server";
import {
  getShareView,
  getOrCreateShare,
  revokeShare,
  updateShare,
  type ShareExpiryOption,
} from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse, readJsonBody } from "@/lib/http";
import { serializeShare } from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface ShareBody {
  access?: string;
  expires_in?: ShareExpiryOption;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const view = await getShareView(getDb(), id, user.id);
    return NextResponse.json({ share: view });
  } catch (error) {
    return problemResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id } = await context.params;
    const body = await readJsonBody<ShareBody>(request);

    const { share, rawToken } = await getOrCreateShare(getDb(), {
      noteId: id,
      ownerId: user.id,
      expiresIn: body.expires_in,
    });

    return NextResponse.json({ share: serializeShare(share, rawToken) });
  } catch (error) {
    return problemResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id } = await context.params;
    const body = await readJsonBody<ShareBody>(request);

    const share = await updateShare(getDb(), {
      noteId: id,
      ownerId: user.id,
      access: body.access,
      expiresIn: body.expires_in,
    });

    const view = await getShareView(getDb(), id, user.id);
    return NextResponse.json({ share: view ?? serializeShare(share, null) });
  } catch (error) {
    return problemResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id } = await context.params;
    await revokeShare(getDb(), { noteId: id, ownerId: user.id });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return problemResponse(error);
  }
}
