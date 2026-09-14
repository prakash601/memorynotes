import { NextResponse } from "next/server";
import { listVersionsPage } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { problemResponse } from "@/lib/http";
import { serializeVersionSummary } from "@/lib/serializers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:read");
    const { id } = await context.params;
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");

    const page = await listVersionsPage(getDb(), id, principal.userId, {
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: url.searchParams.get("cursor"),
    });

    return NextResponse.json({
      data: page.data.map(serializeVersionSummary),
      next_cursor: page.nextCursor,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
