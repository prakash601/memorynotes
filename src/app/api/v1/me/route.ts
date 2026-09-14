import { NextResponse } from "next/server";
import { NotFoundError, deleteAccount, getAccount } from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const account = await getAccount(getDb(), user.id);
    if (!account) {
      throw new NotFoundError("Account not found");
    }
    return NextResponse.json({ account });
  } catch (error) {
    return problemResponse(error);
  }
}

/** Self-serve delete (P5): purges content and versions immediately. */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const result = await deleteAccount(getDb(), user.id);
    return NextResponse.json({
      deleted_at: result.deletedAt,
      purged_notes: result.purgedNotes,
    });
  } catch (error) {
    return problemResponse(error);
  }
}
