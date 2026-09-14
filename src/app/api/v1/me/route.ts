import { NextResponse } from "next/server";
import { NotFoundError, deleteAccount, getAccount } from "@/core";
import { getDb } from "@/db";
import { UnauthorizedError } from "@/core";
import { authenticate } from "@/lib/auth";
import { assertCsrf, problemResponse } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await authenticate(request, "account:read");
    const account = await getAccount(getDb(), principal.userId);
    if (!account) {
      throw new NotFoundError("Account not found");
    }
    return NextResponse.json({ account });
  } catch (error) {
    return problemResponse(error);
  }
}

/**
 * Self-serve delete (P5). Deliberately session-only: a leaked API token must not
 * be able to destroy an account. This is a documented deviation from doc 09.
 */
export async function DELETE(request: Request) {
  try {
    const viewer = await getCurrentUser();
    if (!viewer) {
      throw new UnauthorizedError("Deleting an account requires a signed-in session");
    }
    assertCsrf(request);

    const result = await deleteAccount(getDb(), viewer.id);
    return NextResponse.json({
      deleted_at: result.deletedAt,
      purged_notes: result.purgedNotes,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
