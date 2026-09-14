import { NextResponse } from "next/server";
import { purgeDeletedNotes, purgeExpiredLeases, purgeDeletedUsers } from "@/core";
import { getDb } from "@/db";
import { assertCronSecret, problemResponse } from "@/lib/http";
import { recordJobResult } from "@/lib/observability";

export const dynamic = "force-dynamic";

/**
 * Scheduled maintenance with the shared secret; disabled when unset.
 * Purges soft-deleted notes and accounts past the window and sweeps dead leases.
 */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);
  } catch (error) {
    return problemResponse(error);
  }

  try {
    const db = getDb();
    const purgedNotes = await purgeDeletedNotes(db);
    const purgedUsers = await purgeDeletedUsers(db);
    const purgedLeases = await purgeExpiredLeases(db);

    recordJobResult("purge", true);
    return NextResponse.json({
      purged_notes: purgedNotes,
      purged_users: purgedUsers,
      purged_leases: purgedLeases,
    });
  } catch (error) {
    recordJobResult("purge", false);
    return problemResponse(error);
  }
}
