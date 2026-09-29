import { NextResponse } from "next/server";
import { restoreNote } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, problemResponse } from "@/lib/http";
import { serializeNote, serializeShare } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:delete");
    assertCsrf(request);
    const { id } = await context.params;

    const { note, share, rawToken } = await restoreNote(getDb(), {
      noteId: id,
      ownerId: principal.userId,
    });

    return NextResponse.json({
      ...serializeNote(note),
      share: serializeShare(share, rawToken),
    });
  } catch (error) {
    return problemResponse(error);
  }
}
