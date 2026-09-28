import { afterAll, beforeEach, expect, it } from "vitest";
import {
  createNote,
  listNoteTags,
  listNotes,
  listNotesPage,
  listOwnedTags,
  normalizeTag,
  setFavorite,
  setNoteTags,
  setPinned,
  updateDraft,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("tags, favorites, pins, and search", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  it("normalizes tags and rejects bad input", async () => {
    expect(normalizeTag("  Work ")).toBe("work");
    await expect(
      (async () => {
        normalizeTag("has space");
      })(),
    ).rejects.toThrow();
    await expect(
      (async () => {
        normalizeTag("");
      })(),
    ).rejects.toThrow();
  });

  it("replaces tags with dedup and normalization", async () => {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, { ownerId: userId, title: "t" });

    const tags = await setNoteTags(db, {
      noteId: note.id,
      ownerId: userId,
      tags: ["Work", " work ", "home"],
    });
    expect(tags).toEqual(["work", "home"]);
    expect(await listNoteTags(db, note.id, userId)).toEqual(["home", "work"]);

    const cleared = await setNoteTags(db, { noteId: note.id, ownerId: userId, tags: [] });
    expect(cleared).toEqual([]);
    expect(await listNoteTags(db, note.id, userId)).toEqual([]);
  });

  it("rejects too many tags", async () => {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, { ownerId: userId, title: "t" });
    const tags = Array.from({ length: 21 }, (_, index) => `tag${index}`);
    await expect(setNoteTags(db, { noteId: note.id, ownerId: userId, tags })).rejects.toThrow();
  });

  it("lists owned tags across notes", async () => {
    const userId = await createTestUser(sql);
    const first = await createNote(db, { ownerId: userId, title: "a" });
    const second = await createNote(db, { ownerId: userId, title: "b" });
    await setNoteTags(db, { noteId: first.note.id, ownerId: userId, tags: ["work", "home"] });
    await setNoteTags(db, { noteId: second.note.id, ownerId: userId, tags: ["work"] });
    expect(await listOwnedTags(db, userId)).toEqual(["home", "work"]);
  });

  it("toggles favorite and pinned", async () => {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, { ownerId: userId, title: "t" });

    const fav = await setFavorite(db, { noteId: note.id, ownerId: userId, favorite: true });
    expect(fav.isFavorite).toBe(true);
    const pinned = await setPinned(db, { noteId: note.id, ownerId: userId, pinned: true });
    expect(pinned.isPinned).toBe(true);
  });

  it("searches title and content case-insensitively", async () => {
    const userId = await createTestUser(sql);
    await createNote(db, { ownerId: userId, title: "Grocery list", content: "buy milk" });
    await createNote(db, { ownerId: userId, title: "Work plan", content: "ship it" });

    const byTitle = await listNotes(db, userId, { q: "grocery" });
    expect(byTitle.map((item) => item.title)).toEqual(["Grocery list"]);

    const byContent = await listNotes(db, userId, { q: "MILK" });
    expect(byContent.map((item) => item.title)).toEqual(["Grocery list"]);
  });

  it("treats LIKE wildcards literally", async () => {
    const userId = await createTestUser(sql);
    await createNote(db, { ownerId: userId, title: "100% coverage" });
    await createNote(db, { ownerId: userId, title: "other" });

    const page = await listNotes(db, userId, { q: "100%" });
    expect(page.map((item) => item.title)).toEqual(["100% coverage"]);
  });

  it("filters by tag and favorites", async () => {
    const userId = await createTestUser(sql);
    const first = await createNote(db, { ownerId: userId, title: "a" });
    const second = await createNote(db, { ownerId: userId, title: "b" });
    await setNoteTags(db, { noteId: first.note.id, ownerId: userId, tags: ["work"] });
    await setNoteTags(db, { noteId: second.note.id, ownerId: userId, tags: ["home"] });
    await setFavorite(db, { noteId: second.note.id, ownerId: userId, favorite: true });

    expect((await listNotes(db, userId, { tag: "WORK" })).map((item) => item.id)).toEqual([
      first.note.id,
    ]);
    expect((await listNotes(db, userId, { favoriteOnly: true })).map((item) => item.id)).toEqual([
      second.note.id,
    ]);
    expect(
      (await listNotes(db, userId, { tag: "home", favoriteOnly: true })).map((item) => item.id),
    ).toEqual([second.note.id]);
  });

  it("orders pinned first and paginates stably with filters", async () => {
    const userId = await createTestUser(sql);
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await createNote(db, { ownerId: userId, title: `Note ${index}` });
      ids.push(created.note.id);
    }
    await setPinned(db, { noteId: ids[4]!, ownerId: userId, pinned: true });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result = await listNotesPage(db, userId, { limit: 2, cursor });
      seen.push(...result.data.map((note) => note.id));
      cursor = result.nextCursor;
      if (!cursor) {
        break;
      }
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    // Pinned note leads even though it is the oldest.
    expect(seen[0]).toBe(ids[4]);
  });

  it("keeps list items carrying tags and flags", async () => {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, { ownerId: userId, title: "t" });
    await setNoteTags(db, { noteId: note.id, ownerId: userId, tags: ["work"] });
    await setFavorite(db, { noteId: note.id, ownerId: userId, favorite: true });

    const [item] = await listNotes(db, userId, {});
    expect(item?.tags).toEqual(["work"]);
    expect(item?.isFavorite).toBe(true);
    expect(item?.isPinned).toBe(false);
  });

  it("search reflects the latest draft content", async () => {
    const userId = await createTestUser(sql);
    const { note, draft } = await createNote(db, { ownerId: userId, title: "t" });
    await updateDraft(db, {
      noteId: note.id,
      userId,
      title: "t",
      content: "pineapple recipe",
      baseRevision: draft.revision,
    });

    const page = await listNotesPage(db, userId, { q: "pineapple" });
    expect(page.data.map((item) => item.id)).toEqual([note.id]);
  });
});
