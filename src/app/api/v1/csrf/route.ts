import { NextResponse } from "next/server";
import { CSRF_COOKIE_NAME, createCsrfToken } from "@/lib/csrf";

export const dynamic = "force-dynamic";

/** Issues a double-submit token for cookie-authenticated writes. */
export async function GET() {
  const token = createCsrfToken();
  const response = NextResponse.json({ token });
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
