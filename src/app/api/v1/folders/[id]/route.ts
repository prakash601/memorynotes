import { NextResponse } from "next/server";
import { deleteFolder, moveFolder, renameFolder } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";
import { observed } from "@/lib/observability";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function serializeFolder(folder: { id: string; name: string; parentId: string | null }) {
  return { id: folder.id, name: folder.name, parent_id: folder.parentId };
}

async function handlePatch(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;
    const text = await request.text();
    const body = parseJsonBody<{ name?: string; parent_id?: string | null }>(text);
    const db = getDb();

    let folder = null;
    if (body.name !== undefined) {
      folder = await renameFolder(db, { folderId: id, ownerId: principal.userId, name: body.name });
    }
    if (body.parent_id !== undefined) {
      folder = await moveFolder(db, {
        folderId: id,
        ownerId: principal.userId,
        parentId: body.parent_id,
      });
    }
    if (!folder) {
      return NextResponse.json(
        {
          type: "about:blank",
          title: "Nothing to update",
          status: 422,
          detail: "Provide name and/or parent_id",
          code: "validation",
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ folder: serializeFolder(folder) });
  } catch (error) {
    return problemResponse(error);
  }
}

async function handleDelete(request: Request, context: RouteContext) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const { id } = await context.params;
    await deleteFolder(getDb(), { folderId: id, ownerId: principal.userId });
    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    return problemResponse(error);
  }
}

export const PATCH = observed("folders.update", handlePatch);
export const DELETE = observed("folders.delete", handleDelete);
