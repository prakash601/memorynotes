import { NextResponse } from "next/server";
import { isDomainError, resolveDomainAccess, resolveShare } from "@/core";
import { getDb } from "@/db";
import { getEnv } from "@/env";
import { renderMarkdown } from "@/lib/markdown";
import { limit } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import { observed } from "@/lib/observability";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function document(title: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/read.css">
</head>
<body>
<main class="read">
${main}
</main>
</body>
</html>`;
}

/**
 * Served from the share domain (ADR-0007). Deliberately a raw HTML response with
 * no client runtime: the CSP forbids scripts, and the page loads no third-party
 * assets at all, so the reader's IP is never exposed to anyone but us.
 */
function htmlResponse(
  body: string,
  status: number,
  robots: string,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": [
        "default-src 'none'",
        "style-src 'self'",
        "img-src 'none'",
        "font-src 'none'",
        "script-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      robots,
      ...extraHeaders,
    },
  });
}

function notice(title: string, message: string): string {
  return `<h1 class="title">${escapeHtml(title)}</h1><p class="muted">${escapeHtml(message)}</p>`;
}

async function handleGet(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const url = new URL(request.url);

  try {
    const env = getEnv();

    // Defence in depth behind the proxy: content is only ever served from the
    // share host (ADR-0007).
    const decision = resolveDomainAccess({
      host: request.headers.get("host"),
      pathname: url.pathname,
      search: url.search,
      appUrl: env.APP_URL,
      shareDomain: env.SHARE_DOMAIN,
    });
    if (decision.action === "redirect") {
      return NextResponse.redirect(decision.location, 308);
    }

    // Doc 06: 1000 reads/minute/IP. The IP is hashed before it is used as a key.
    await limit("read_ip_minute", hashIp(clientIp(request)));

    const { note, version, share } = await resolveShare(getDb(), token);

    // Only pay for a session lookup when the outcome depends on who is asking.
    const needsViewer = note.visibility === "private" || share.access === "edit";
    const viewer = needsViewer ? await getCurrentUser() : null;

    if (note.visibility === "private" && (!viewer || viewer.id !== note.ownerId)) {
      return htmlResponse(
        document("Private note", notice("Private note", "Sign in as the owner to read this note.")),
        403,
        "noindex, nofollow",
      );
    }

    const indexable = note.visibility === "public";
    const meta = version.message
      ? `v${version.versionNumber} · ${version.message}`
      : `v${version.versionNumber}`;

    const appUrl = env.APP_URL.replace(/\/$/, "");
    const actions: string[] = [
      `<a class="action" href="${appUrl}/report?token=${encodeURIComponent(token)}">Report</a>`,
    ];
    if (share.access === "edit") {
      actions.unshift(
        viewer
          ? `<a class="action" href="${appUrl}/notes/${encodeURIComponent(note.id)}?share=${encodeURIComponent(token)}">Edit this note</a>`
          : `<a class="action" href="${appUrl}/signin">Sign in to edit</a>`,
      );
    }

    const main = [
      `<header class="head">`,
      `<h1 class="title">${escapeHtml(version.title || "Untitled")}</h1>`,
      `<p class="meta">${escapeHtml(meta)}</p>`,
      `<p class="actions">${actions.join("\n")}</p>`,
      `</header>`,
      `<article class="content">${renderMarkdown(version.content)}</article>`,
    ].join("\n");

    return htmlResponse(
      document(version.title || "Untitled", main),
      200,
      indexable ? "index, follow" : "noindex, nofollow",
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "gone") {
      return htmlResponse(
        document(
          "Link unavailable",
          notice(
            "This link is no longer available",
            "It expired, was revoked, or the note was deleted.",
          ),
        ),
        410,
        "noindex, nofollow",
      );
    }

    if (isDomainError(error) && error.code === "rate_limited") {
      return htmlResponse(
        document("Too many requests", notice("Too many requests", "Please slow down.")),
        429,
        "noindex, nofollow",
        { "retry-after": String("retryAfter" in error ? error.retryAfter : 60) },
      );
    }

    return htmlResponse(
      document("Not found", notice("Not found", "This link does not exist.")),
      404,
      "noindex, nofollow",
    );
  }
}

export const GET = observed("read.note", handleGet);
