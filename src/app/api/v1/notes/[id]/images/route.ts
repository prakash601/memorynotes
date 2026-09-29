import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertCanEdit, imageFingerprint, validateImageUpload } from "@/core";
import { getDb } from "@/db";
import { noteImages } from "@/db/schema";
import { authenticate } from "@/lib/auth";
import { applyRateLimitHeaders, assertCsrf, problemResponse } from "@/lib/http";
import { beginIdempotency } from "@/lib/idempotency";
import { deleteImageFile, saveImageFile } from "@/lib/image-store";
import { limit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Image upload for note markdown (issue #71). The file is sniffed, capped at
 * 5 MiB, and stored on the app domain; the returned relative URL embeds on
 * both the app and the share host. SVG and executables are rejected.
 *
 * Writes are guarded like every other write path: an hourly per-account
 * upload budget plus `Idempotency-Key` replay, fingerprinted on the exact
 * bytes so a retried upload replays and a different file under the same key
 * conflicts.
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
          detail: "field `file` is required",
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

    const idempotency = await beginIdempotency(request, principal, imageFingerprint(id, bytes));
    if (idempotency.replay) {
      return idempotency.replay;
    }

    const state = await limit("image_upload_hour", principal.userId);

    const imageId = randomUUID();
    const name = `${imageId}.${validated.extension}`;
    const db = getDb();
    // The file lands first: if the row insert fails we remove the file and
    // throw, so a failed upload never leaves a row that serves a permanent
    // 404. An orphan file (insert succeeded, response lost) is unreferenced
    // and unguessable; an orphan row would be user-visible breakage.
    await saveImageFile(name, bytes);
    try {
      await db.insert(noteImages).values({
        id: imageId,
        noteId: id,
        ownerId: principal.userId,
        contentType: validated.contentType,
        sizeBytes: validated.sizeBytes,
      });
    } catch (error) {
      await deleteImageFile(name);
      throw error;
    }

    const response = NextResponse.json(
      {
        id: imageId,
        url: `/uploads/${name}`,
        content_type: validated.contentType,
        size_bytes: validated.sizeBytes,
      },
      { status: 201 },
    );
    return idempotency.complete(applyRateLimitHeaders(response, state));
  } catch (error) {
    return problemResponse(error);
  }
}
