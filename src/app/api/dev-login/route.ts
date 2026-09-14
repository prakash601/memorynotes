import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { devLoginEnabled } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { DEV_USER_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

function safeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/";
}

/**
 * Development-only sign-in: sets a cookie that `getCurrentUser` honors when
 * `ENABLE_DEV_LOGIN=true`. Returns 404 in production. Never used by real auth.
 */
export async function GET(request: Request) {
  if (!devLoginEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? "demo@local.test").trim().toLowerCase();
  const next = safeNext(url.searchParams.get("next"));

  const db = getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (!existing) {
    await db.insert(users).values({ email, name: email.split("@")[0], emailVerified: new Date() });
  }

  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(DEV_USER_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
