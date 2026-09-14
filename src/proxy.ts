import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveDomainAccess } from "@/core/domains";
import { getEnv } from "@/env";

/**
 * Enforces content domain isolation (ADR-0007) before rendering: user content
 * only on the share host, product pages only on the app host. The same rule is
 * re-checked in the read route as defence in depth.
 */
export function proxy(request: NextRequest): NextResponse {
  const env = getEnv();
  const decision = resolveDomainAccess({
    host: request.headers.get("host"),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    appUrl: env.APP_URL,
    shareDomain: env.SHARE_DOMAIN,
  });

  if (decision.action === "redirect") {
    return NextResponse.redirect(decision.location, 308);
  }

  return NextResponse.next();
}

export const config = {
  // Skip the immutable build assets; everything else may need a domain decision.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
