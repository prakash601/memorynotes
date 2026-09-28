import { NextResponse } from "next/server";
import { buildFolderTree, createFolder, listFolders } from "@/core";
import { getDb } from "@/db";
import { authenticate } from "@/lib/auth";
import { assertCsrf, parseJsonBody, problemResponse } from "@/lib/http";
import { observed } from "@/lib/observability";

export const dynamic = "force-dynamic";

function serializeFolder(folder: { id: string; name: string; parentId: string | null }) {
  return { id: folder.id, name: folder.name, parent_id: folder.parentId };
}

async function handleGet(request: Request) {
  try {
    const principal = await authenticate(request, "notes:read");
    const rows = await listFolders(getDb(), principal.userId);
    const tree = buildFolderTree(rows);
    const flatten = (nodes: typeof tree): ReturnType<typeof serializeFolder>[] =>
      nodes.flatMap((node) => [serializeFolder(node), ...flatten(node.children)]);
    return NextResponse.json({ data: flatten(tree) });
  } catch (error) {
    return problemResponse(error);
  }
}

async function handlePost(request: Request) {
  try {
    const principal = await authenticate(request, "notes:write");
    assertCsrf(request);
    const text = await request.text();
    const body = parseJsonBody<{ name?: string; parent_id?: string | null }>(text);
    const folder = await createFolder(getDb(), {
      ownerId: principal.userId,
      name: body.name ?? "",
      parentId: body.parent_id ?? null,
    });
    return NextResponse.json({ folder: serializeFolder(folder) }, { status: 201 });
  } catch (error) {
    return problemResponse(error);
  }
}

export const GET = observed("folders.list", handleGet);
export const POST = observed("folders.create", handlePost);
