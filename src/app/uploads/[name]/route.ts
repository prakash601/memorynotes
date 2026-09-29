import { NextResponse } from "next/server";
import { assertSafeImageKey, readImageFile } from "@/lib/image-store";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

type RouteContext = { params: Promise<{ name: string }> };

/**
 * Serves uploaded note images on either host (the share page embeds relative
 * /uploads URLs). Ids are unguessable uuids, so no auth is needed; the name
 * shape is strictly validated and the content type is pinned to the
 * validated raster type, never sniffed.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { name } = await context.params;
  let ext: string;
  try {
    ext = assertSafeImageKey(name).ext;
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = await readImageFile(name);
  if (!bytes) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = new Uint8Array(bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "content-length": String(body.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
