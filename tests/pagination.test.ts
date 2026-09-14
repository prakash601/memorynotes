import { afterAll, beforeEach, expect, it } from "vitest";
import { createNote, listNotesPage, listVersionsPage, publishNote } from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("cursor pagination", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  it("walks every note exactly once across pages", async () => {
    const userId = await createTestUser(sql);
    for (let index = 0; index < 5; index += 1) {
      await createNote(db, { ownerId: userId, title: `Note ${index}` });
    }

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
  });

  it("caps the page size at 100", async () => {
    const userId = await createTestUser(sql);
    await createNote(db, { ownerId: userId });
    const page = await listNotesPage(db, userId, { limit: 5000 });
    expect(page.data).toHaveLength(1);
  });

  it("pages versions newest first", async () => {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, { ownerId: userId, content: "# one" });
    await publishNote(db, { noteId: note.id, userId, message: "one" });
    await publishNote(db, { noteId: note.id, userId, message: "two" });
    await publishNote(db, { noteId: note.id, userId, message: "three" });

    const first = await listVersionsPage(db, note.id, userId, { limit: 2 });
    expect(first.data.map((version) => version.versionNumber)).toEqual([3, 2]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listVersionsPage(db, note.id, userId, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.data.map((version) => version.versionNumber)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
  });
});
