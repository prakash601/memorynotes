import { NextResponse } from "next/server";
import { exportAccount } from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Doc 09 specifies POST /me/export. GET is added so the settings page can offer
 * a plain download link: it is a safe, session-authenticated read.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const format = new URL(request.url).searchParams.get("format");
    const exported = await exportAccount(getDb(), user.id);

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

/** Export every note as JSON plus markdown (P5). */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const exported = await exportAccount(getDb(), user.id);
    return NextResponse.json(exported);
  } catch (error) {
    return problemResponse(error);
  }
}
