/**
 * Content domain isolation (ADR-0007). Pure, framework-free helpers so both the
 * proxy and the route handlers can apply the same rule, and so the rule is
 * testable without a running server.
 */
export type DomainDecision =
  | { action: "allow" }
  | { action: "redirect"; location: string; reason: "content_off_app" | "app_off_content" };

/** Strips the scheme and any path, keeping host:port for comparison. */
export function hostOf(value: string): string {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  return withoutScheme.split("/")[0].toLowerCase();
}

/** The public read surface: `/n` and `/n/<token>`. */
export function isUserContentPath(pathname: string): boolean {
  return pathname === "/n" || pathname.startsWith("/n/");
}

/** Uploaded note images, served from either host so share pages can embed them. */
export function isUploadPath(pathname: string): boolean {
  return pathname === "/uploads" || pathname.startsWith("/uploads/");
}

/** Assets the read page needs on whatever host it is served from. */
export function isStaticAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    isUploadPath(pathname) ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

export interface DomainAccessInput {
  host: string | null;
  pathname: string;
  search?: string;
  appUrl: string;
  shareDomain: string;
}

function withSearch(pathname: string, search?: string): string {
  return search && search.length > 0 ? `${pathname}${search}` : pathname;
}

/**
 * Decides whether a request may be served from the host it arrived on.
 *
 * - User content is only ever served from the share host. A content request on
 *   the app host is redirected there.
 * - Product pages are only ever served from the app host. A non-asset page on
 *   the share host is redirected there.
 * - When the two hosts are equal (local development), everything is allowed.
 */
export function resolveDomainAccess(input: DomainAccessInput): DomainDecision {
  const appHost = hostOf(input.appUrl);
  const shareHost = hostOf(input.shareDomain);
  const requestHost = (input.host ?? "").toLowerCase();

  // Single-host development: no split to enforce.
  if (appHost === shareHost) {
    return { action: "allow" };
  }

  const path = withSearch(input.pathname, input.search);

  if (isUserContentPath(input.pathname)) {
    if (requestHost === shareHost) {
      return { action: "allow" };
    }
    return {
      action: "redirect",
      location: `https://${shareHost}${path}`,
      reason: "content_off_app",
    };
  }

  if (requestHost === shareHost && !isStaticAssetPath(input.pathname)) {
    return {
      action: "redirect",
      location: `https://${appHost}${path}`,
      reason: "app_off_content",
    };
  }

  return { action: "allow" };
}
