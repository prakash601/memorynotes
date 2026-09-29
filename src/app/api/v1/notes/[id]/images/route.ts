import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertCanEdit, validateImageUpload } from "@/core";
import { getDb } from "@/db";
import { noteImages } from "@/db/schema";
import { authenticate } from "@/lib/auth";
import { assertCsrf, problemResponse } from "@/lib/http";
import { saveImageFile } from "@/lib/image-store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Image upload for note markdown (issue #71). The file is sniffed, capped at
 * 5 MiB, and stored on the app domain; the returned relative URL embeds on
 * both the app and the share host. SVG and executables are rejected.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const shareTokenField = form?.get("share_token");
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          type: "about:blank",
          title: "Validation failed",
          status: 422,
          detail: " field `file` is required",
          code: "validation",
        },
        { status: 422 },
      );
    }

    await assertCanEdit(getDb(), {
      noteId: id,
      userId: principal.userId,
      shareToken: typeof shareTokenField === "string" ? shareTokenField : null,
    });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = validateImageUpload(bytes, file.type || null);

    const imageId = randomUUID();
    const name = `${imageId}.${validated.extension}`;
    const db = getDb();
    await db.insert(noteImages).values({
      id: imageId,
      noteId: id,
      ownerId: principal.userId,
      contentType: validated.contentType,
      sizeBytes: validated.sizeBytes,
    });
    await saveImageFile(name, bytes);

    return NextResponse.json(
      {
        id: imageId,
        url: `/uploads/${name}`,
        content_type: validated.contentType,
        size_bytes: validated.sizeBytes,
      },
      { status: 201 },
    );
  } catch (error) {
    return problemResponse(error);
  }
}
