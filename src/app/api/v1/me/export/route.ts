import { NextResponse } from "next/server";
import { exportAccount } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

/**
 * Doc 09 specifies POST /me/export. GET is added so the settings page can offer
 * a plain download link: it is a safe, read-only operation.
 */
export async function GET(request: Request) {
  try {
    const principal = await authenticate(request, "account:read");
    const format = new URL(request.url).searchParams.get("format");
    const exported = await exportAccount(getDb(), principal.userId);

    if (format === "markdown") {
      return new NextResponse(exported.markdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="memorynotes-export.md"`,
        },
      });
    }

    return new NextResponse(JSON.stringify(exported, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="memorynotes-export.json"`,
      },
    });
  } catch (error) {
    return problemResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authenticate(request, "account:read");
    assertCsrf(request);

    const idempotency = await beginIdempotency(request, principal, "");
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const exported = await exportAccount(getDb(), principal.userId);
    return idempotency.complete(NextResponse.json(exported));
  } catch (error) {
    return problemResponse(error);
  }
}
