import { NextResponse } from "next/server";
import { publishNote } from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse, readJsonBody } from "@/lib/http";
import { serializeVersionSummary } from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface PublishBody {
  message?: string;
  base_revision?: number;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id } = await context.params;
    const body = await readJsonBody<PublishBody>(request);

    const version = await publishNote(getDb(), {
      noteId: id,
      userId: user.id,
      message: body.message ?? null,
      baseRevision: body.base_revision,
    });

    return NextResponse.json(
      { published_version: serializeVersionSummary(version) },
      { status: 201 },
    );
  } catch (error) {
    return problemResponse(error);
  }
}
