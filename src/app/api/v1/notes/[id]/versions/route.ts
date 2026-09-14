import { NextResponse } from "next/server";
import { listVersions } from "@/core";
import { getDb } from "@/db";
import { problemResponse } from "@/lib/http";
import { serializeVersionSummary } from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const versions = await listVersions(getDb(), id, user.id);

    return NextResponse.json({
      data: versions.map(serializeVersionSummary),
      next_cursor: null,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
