import { NextResponse } from "next/server";
import { rotateShare } from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse } from "@/lib/http";
import { serializeShare } from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id } = await context.params;

    const { share, rawToken } = await rotateShare(getDb(), {
      noteId: id,
      ownerId: user.id,
    });

    return NextResponse.json({ share: serializeShare(share, rawToken) });
  } catch (error) {
    return problemResponse(error);
  }
}
