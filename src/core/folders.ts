import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { folders, notes, type Folder } from "@/db/schema";
import { requireOwnedNote } from "./notes";
import { NotFoundError, ValidationError } from "./errors";

export const MAX_FOLDER_NAME_LENGTH = 100;
export const MAX_FOLDER_DEPTH = 10;

export function normalizeFolderName(name: string | undefined | null): string {
  const value = (name ?? "").trim();
  if (!value) {
    throw new ValidationError("Folder name must not be empty");
  }
  if (value.length > MAX_FOLDER_NAME_LENGTH) {
    throw new ValidationError(`Folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer`);
  }
  return value;
}

async function requireOwnedFolder(
  db: Database,
  folderId: string,
  ownerId: string,
): Promise<Folder> {
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.ownerId, ownerId)))
    .limit(1);
  if (!folder) {
    throw new NotFoundError("Folder not found");
  }
  return folder;
}

async function assertNoCycle(
  db: Database,
  ownerId: string,
  folderId: string,
  parentId: string | null,
): Promise<void> {
  let current: string | null = parentId;
  let depth = 0;
  while (current) {
    if (current === folderId) {
      throw new ValidationError("A folder cannot live inside itself");
    }
    depth += 1;
    if (depth > MAX_FOLDER_DEPTH) {
      throw new ValidationError(`Folders nest at most ${MAX_FOLDER_DEPTH} deep`);
    }
    const [row] = await db
      .select({ parentId: folders.parentId })
      .from(folders)
      .where(and(eq(folders.id, current), eq(folders.ownerId, ownerId)))
      .limit(1);
    if (!row) {
      break;
    }
    current = row.parentId;
  }
}

export async function createFolder(
  db: Database,
  input: { ownerId: string; name: string; parentId?: string | null },
): Promise<Folder> {
  const name = normalizeFolderName(input.name);
  let parentId: string | null = input.parentId ?? null;
  if (parentId) {
    await requireOwnedFolder(db, parentId, input.ownerId);
  } else {
    parentId = null;
  }
  const [folder] = await db
    .insert(folders)
    .values({ ownerId: input.ownerId, name, parentId })
    .returning();
  // A brand-new row cannot be its own ancestor, but the depth cap still applies.
  await assertNoCycle(db, input.ownerId, folder.id, parentId);
  return folder;
}

export async function renameFolder(
  db: Database,
  input: { folderId: string; ownerId: string; name: string },
): Promise<Folder> {
  await requireOwnedFolder(db, input.folderId, input.ownerId);
  const name = normalizeFolderName(input.name);
  const [updated] = await db
    .update(folders)
    .set({ name, updatedAt: new Date() })
    .where(eq(folders.id, input.folderId))
    .returning();
  return updated;
}

export async function moveFolder(
  db: Database,
  input: { folderId: string; ownerId: string; parentId: string | null },
): Promise<Folder> {
  await requireOwnedFolder(db, input.folderId, input.ownerId);
  let parentId: string | null = input.parentId;
  if (parentId) {
    await requireOwnedFolder(db, parentId, input.ownerId);
  } else {
    parentId = null;
  }
  await assertNoCycle(db, input.ownerId, input.folderId, parentId);
  const [updated] = await db
    .update(folders)
    .set({ parentId, updatedAt: new Date() })
    .where(eq(folders.id, input.folderId))
    .returning();
  return updated;
}

/**
 * Deletes a folder without touching note content: notes inside move to the
 * deleted folder's parent (or to no folder), subfolders are reparented the
 * same way, and share links are unaffected.
 */
export async function deleteFolder(
  db: Database,
  input: { folderId: string; ownerId: string },
): Promise<void> {
  const folder = await requireOwnedFolder(db, input.folderId, input.ownerId);
  await db.transaction(async (tx) => {
    await tx
      .update(folders)
      .set({ parentId: folder.parentId, updatedAt: new Date() })
      .where(eq(folders.parentId, input.folderId));
    await tx
      .update(notes)
      .set({ folderId: folder.parentId, updatedAt: new Date() })
      .where(eq(notes.folderId, input.folderId));
    await tx.delete(folders).where(eq(folders.id, input.folderId));
  });
}

export async function listFolders(db: Database, ownerId: string): Promise<Folder[]> {
  return db.select().from(folders).where(eq(folders.ownerId, ownerId)).orderBy(folders.name);
}

export interface FolderNode extends Folder {
  children: FolderNode[];
  depth: number;
}

/** Nests the flat owner-scoped list into a tree, roots first by name. */
export function buildFolderTree(rows: Folder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [], depth: 0 });
  }
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      const parent = byId.get(node.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const byName = (a: FolderNode, b: FolderNode) => a.name.localeCompare(b.name);
  for (const node of byId.values()) {
    node.children.sort(byName);
  }
  roots.sort(byName);
  return roots;
}

/** Moves a note the caller owns into a folder (or out, with null). */
export async function setNoteFolder(
  db: Database,
  input: { noteId: string; ownerId: string; folderId: string | null },
) {
  await requireOwnedNote(db, input.noteId, input.ownerId);
  if (input.folderId) {
    await requireOwnedFolder(db, input.folderId, input.ownerId);
  }
  const [updated] = await db
    .update(notes)
    .set({ folderId: input.folderId, updatedAt: new Date() })
    .where(eq(notes.id, input.noteId))
    .returning();
  return updated;
}

/** Counts live notes per folder for the sidebar. */
export async function countNotesByFolder(
  db: Database,
  ownerId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ folderId: notes.folderId })
    .from(notes)
    .where(and(eq(notes.ownerId, ownerId), isNull(notes.deletedAt)));
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.folderId) {
      counts[row.folderId] = (counts[row.folderId] ?? 0) + 1;
    }
  }
  return counts;
}
