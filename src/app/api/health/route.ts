import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";

/** Always evaluated per request, never prerendered at build time. */
export const dynamic = "force-dynamic";

export async function GET() {
  const base = {
    version: process.env.npm_package_version ?? "0.1.0",
    timestamp: new Date().toISOString(),
  };

  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ ...base, status: "ok", database: "up" });
  } catch {
    return NextResponse.json({ ...base, status: "degraded", database: "down" }, { status: 503 });
  }
}
