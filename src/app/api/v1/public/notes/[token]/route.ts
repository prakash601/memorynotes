import { NextResponse } from "next/server";
import { ForbiddenError, hashToken, resolveShare } from "@/core";
import { getDb } from "@/db";
import { problemResponse } from "@/lib/http";
import { limit } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * The published version as JSON (doc 09). Private notes are never exposed here;
 * unlisted notes are readable by anyone holding the token, same as the HTML page.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    await limit("read_ip_minute", hashIp(clientIp(request)));
    const { token } = await context.params;
    const url = new URL(request.url);
    const password = url.searchParams.get("password");
    if (password !== null) {
      await limit("share_password_attempt", `${hashIp(clientIp(request))}:${hashToken(token)}`);
    }
    const { note, version } = await resolveShare(getDb(), token, new Date(), {
      password: password ?? undefined,
    });

    if (note.visibility === "private") {
      throw new ForbiddenError("This note is private");
    }

    return NextResponse.json({
      id: note.id,
      title: version.title,
      content: version.content,
      version_number: version.versionNumber,
      message: version.message,
      visibility: note.visibility,
      created_at: version.createdAt,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
