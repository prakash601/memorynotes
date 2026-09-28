import { afterAll, beforeEach, expect, it } from "vitest";
import {
  buildFolderTree,
  createFolder,
  createNote,
  deleteFolder,
  getShareView,
  listFolders,
  listNotes,
  listNotesPage,
  moveFolder,
  renameFolder,
  setNoteFolder,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("folders and collections", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  it("creates nested folders and builds a tree", async () => {
    const userId = await createTestUser(sql);
    const root = await createFolder(db, { ownerId: userId, name: "Work" });
    const child = await createFolder(db, { ownerId: userId, name: "Plans", parentId: root.id });

    const tree = buildFolderTree(await listFolders(db, userId));
    expect(tree.map((node) => node.name)).toEqual(["Work"]);
    expect(tree[0]?.children.map((node) => node.name)).toEqual(["Plans"]);
    expect(child.parentId).toBe(root.id);
  });

  it("rejects empty and overlong names", async () => {
    const userId = await createTestUser(sql);
    await expect(createFolder(db, { ownerId: userId, name: "  " })).rejects.toThrow();
    await expect(createFolder(db, { ownerId: userId, name: "x".repeat(101) })).rejects.toThrow();
  });

  it("rejects cycles when moving folders", async () => {
    const userId = await createTestUser(sql);
    const root = await createFolder(db, { ownerId: userId, name: "root" });
    const child = await createFolder(db, { ownerId: userId, name: "child", parentId: root.id });

    await expect(
      moveFolder(db, { folderId: root.id, ownerId: userId, parentId: child.id }),
    ).rejects.toThrow();
    await expect(
      moveFolder(db, { folderId: root.id, ownerId: userId, parentId: root.id }),
    ).rejects.toThrow();
  });

  it("moves notes between folders and filters by folder", async () => {
    const userId = await createTestUser(sql);
    const folder = await createFolder(db, { ownerId: userId, name: "Work" });
    const { note } = await createNote(db, { ownerId: userId, title: "a" });

    await setNoteFolder(db, { noteId: note.id, ownerId: userId, folderId: folder.id });
    expect((await listNotes(db, userId, { folderId: folder.id })).map((item) => item.id)).toEqual([
      note.id,
    ]);
    expect(await listNotes(db, userId, { folderId: null })).toEqual([]);

    await setNoteFolder(db, { noteId: note.id, ownerId: userId, folderId: null });
    expect((await listNotes(db, userId, { folderId: folder.id })).length).toBe(0);
  });

  it("keeps pagination stable with a folder filter", async () => {
    const userId = await createTestUser(sql);
    const folder = await createFolder(db, { ownerId: userId, name: "Work" });
    for (let index = 0; index < 4; index += 1) {
      const created = await createNote(db, { ownerId: userId, title: `n${index}` });
      if (index % 2 === 0) {
        await setNoteFolder(db, { noteId: created.note.id, ownerId: userId, folderId: folder.id });
      }
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result = await listNotesPage(db, userId, { limit: 1, cursor, folderId: folder.id });
      seen.push(...result.data.map((note) => note.id));
      cursor = result.nextCursor;
      if (!cursor) {
        break;
      }
    }
    expect(seen).toHaveLength(2);
  });

  it("deletes a folder by reparenting children and keeping notes", async () => {
    const userId = await createTestUser(sql);
    const root = await createFolder(db, { ownerId: userId, name: "root" });
    const child = await createFolder(db, { ownerId: userId, name: "child", parentId: root.id });
    const { note } = await createNote(db, { ownerId: userId, title: "a" });
    await setNoteFolder(db, { noteId: note.id, ownerId: userId, folderId: child.id });

    await deleteFolder(db, { folderId: root.id, ownerId: userId });

    const remaining = await listFolders(db, userId);
    expect(remaining.map((folder) => folder.name)).toEqual(["child"]);
    expect(remaining[0]?.parentId).toBeNull();

    const notes = await listNotes(db, userId, {});
    expect(notes[0]?.folderId).toBe(child.id);
    expect(notes[0]?.title).toBe("a");
  });

  it("keeps share links intact across moves and folder deletes", async () => {
    const userId = await createTestUser(sql);
    const folder = await createFolder(db, { ownerId: userId, name: "Work" });
    const { note, rawToken } = await createNote(db, { ownerId: userId, title: "shared" });

    await setNoteFolder(db, { noteId: note.id, ownerId: userId, folderId: folder.id });
    const afterMove = await getShareView(db, note.id, userId);
    expect(afterMove?.rawToken).toBe(rawToken);

    await deleteFolder(db, { folderId: folder.id, ownerId: userId });
    const afterDelete = await getShareView(db, note.id, userId);
    expect(afterDelete?.rawToken).toBe(rawToken);
    expect((await listNotes(db, userId, {}))[0]?.id).toBe(note.id);
  });

  it("renames folders", async () => {
    const userId = await createTestUser(sql);
    const folder = await createFolder(db, { ownerId: userId, name: "old" });
    const renamed = await renameFolder(db, { folderId: folder.id, ownerId: userId, name: "new" });
    expect(renamed.name).toBe("new");
  });

  it("scopes folders to the owner", async () => {
    const alice = await createTestUser(sql, "alice");
    const bob = await createTestUser(sql, "bob");
    const folder = await createFolder(db, { ownerId: alice, name: "secret" });

    expect(await listFolders(db, bob)).toEqual([]);
    await expect(
      setNoteFolder(db, {
        noteId: "00000000-0000-0000-0000-000000000000",
        ownerId: bob,
        folderId: folder.id,
      }),
    ).rejects.toThrow();
    const { note } = await createNote(db, { ownerId: bob, title: "b" });
    await expect(
      setNoteFolder(db, { noteId: note.id, ownerId: bob, folderId: folder.id }),
    ).rejects.toThrow();
  });

  it("creates notes directly into a folder and rejects foreign folders", async () => {
    const alice = await createTestUser(sql, "alice");
    const bob = await createTestUser(sql, "bob");
    const folder = await createFolder(db, { ownerId: alice, name: "Work" });

    const created = await createNote(db, { ownerId: alice, title: "a", folderId: folder.id });
    expect(created.note.folderId).toBe(folder.id);

    await expect(
      createNote(db, { ownerId: bob, title: "b", folderId: folder.id }),
    ).rejects.toThrow();
  });
});
