import { NextResponse } from "next/server";
import { ValidationError, restoreVersion } from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse } from "@/lib/http";
import { serializeDraft, serializeVersionSummary } from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; n: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id, n } = await context.params;
    const versionNumber = Number(n);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new ValidationError("Version number must be a positive integer");
    }

    const { version, draft } = await restoreVersion(getDb(), {
      noteId: id,
      userId: user.id,
      versionNumber,
    });

    return NextResponse.json({
      published_version: serializeVersionSummary(version),
      draft: serializeDraft(draft),
    });
  } catch (error) {
    return problemResponse(error);
  }
}
