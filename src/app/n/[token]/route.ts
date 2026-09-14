import { NextResponse } from "next/server";
import { isDomainError, resolveShare } from "@/core";
import { getDb } from "@/db";
import { renderMarkdown } from "@/lib/markdown";
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
function htmlResponse(body: string, status: number, robots: string): NextResponse {
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
    },
  });
}

function notice(title: string, message: string): string {
  return `<h1 class="title">${escapeHtml(title)}</h1><p class="muted">${escapeHtml(message)}</p>`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;

  try {
    const { note, version } = await resolveShare(getDb(), token);

    if (note.visibility === "private") {
      const viewer = await getCurrentUser();
      if (!viewer || viewer.id !== note.ownerId) {
        return htmlResponse(
          document(
            "Private note",
            notice("Private note", "Sign in as the owner to read this note."),
          ),
          403,
          "noindex, nofollow",
        );
      }
    }

    const indexable = note.visibility === "public";
    const meta = version.message
      ? `v${version.versionNumber} · ${version.message}`
      : `v${version.versionNumber}`;

    const main = [
      `<header class="head">`,
      `<h1 class="title">${escapeHtml(version.title || "Untitled")}</h1>`,
      `<p class="meta">${escapeHtml(meta)}</p>`,
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

    return htmlResponse(
      document("Not found", notice("Not found", "This link does not exist.")),
      404,
      "noindex, nofollow",
    );
  }
}
