import { NextResponse } from "next/server";
import { ValidationError, diffVersionToDraft, diffVersions } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { problemResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; n: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:read");
    const { id, n } = await context.params;
    const fromVersion = Number(n);
    if (!Number.isInteger(fromVersion) || fromVersion < 1) {
      throw new ValidationError("Version number must be a positive integer");
    }

    const url = new URL(request.url);
    const toParam = url.searchParams.get("to") ?? "draft";
    const shareToken = url.searchParams.get("share_token");

    if (toParam === "draft" || toParam === "current") {
      const diff = await diffVersionToDraft(getDb(), id, principal.userId, fromVersion, shareToken);
      return NextResponse.json({
        from_version: diff.fromVersion,
        to_version: diff.toVersion,
        to_draft: diff.toDraft,
        title_diff: diff.title,
        content_diff: diff.content,
      });
    }

    const toVersion = Number(toParam);
    if (!Number.isInteger(toVersion) || toVersion < 1) {
      throw new ValidationError("Query param 'to' must be 'draft' or a positive version number");
    }
    const diff = await diffVersions(
      getDb(),
      id,
      principal.userId,
      fromVersion,
      toVersion,
      shareToken,
    );
    return NextResponse.json({
      from_version: diff.fromVersion,
      to_version: diff.toVersion,
      to_draft: diff.toDraft,
      title_diff: diff.title,
      content_diff: diff.content,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
