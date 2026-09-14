import { NextResponse } from "next/server";
import { UnauthorizedError, constantTimeEqual, purgeDeletedNotes } from "@/core";
import { getDb } from "@/db";
import { getEnv } from "@/env";
import { problemResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Purges notes soft-deleted longer than the retention window. Intended to be
 * called by a scheduler with the shared secret; disabled when unset.
 */
export async function POST(request: Request) {
  try {
    const secret = getEnv().CRON_SECRET;
    if (!secret) {
      throw new UnauthorizedError("The purge job is not configured");
    }

    const header = request.headers.get("authorization") ?? "";
    if (!header.toLowerCase().startsWith("bearer ")) {
      throw new UnauthorizedError("Missing purge credentials");
    }
    if (!constantTimeEqual(header.slice(7).trim(), secret)) {
      throw new UnauthorizedError("Invalid purge credentials");
    }

    const purged = await purgeDeletedNotes(getDb());
    return NextResponse.json({ purged });
  } catch (error) {
    return problemResponse(error);
  }
}
