import { afterAll, beforeEach, expect, it } from "vitest";
import {
  createNote,
  deleteAccount,
  exportAccount,
  getAccount,
  publishNote,
  purgeDeletedUsers,
  updateDraft,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("account export and delete", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  it("exports every note with its draft, link, and versions", async () => {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, {
      ownerId: userId,
      title: "Exported",
      content: "# First",
    });
    await publishNote(db, { noteId: note.id, userId, message: "one" });
    await updateDraft(db, { noteId: note.id, userId, content: "# Second", baseRevision: 1 });
    await publishNote(db, { noteId: note.id, userId, message: "two" });

    const exported = await exportAccount(db, userId);

    expect(exported.account.email).toBeTruthy();
    expect(exported.notes).toHaveLength(1);
    expect(exported.notes[0].title).toBe("Exported");
    expect(exported.notes[0].content).toBe("# Second");
    expect(exported.notes[0].versions).toHaveLength(2);
    expect(exported.notes[0].share?.url).toContain("/n/");
    expect(exported.markdown).toContain("# Exported");
    expect(exported.markdown).toContain("v2");
  });

  it("delete purges content and versions and tombstones the account", async () => {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, { ownerId: userId, content: "# Gone" });
    await publishNote(db, { noteId: note.id, userId });

    const result = await deleteAccount(db, userId);

    expect(result.purgedNotes).toBe(1);
    const [counts] = await sql<{ notes: number; versions: number; shares: number }[]>`
      select
        (select count(*) from notes)::int as notes,
        (select count(*) from note_versions)::int as versions,
        (select count(*) from note_shares)::int as shares
    `;
    expect(counts).toEqual({ notes: 0, versions: 0, shares: 0 });

    const account = await getAccount(db, userId);
    expect(account?.status).toBe("deleted");
    expect(account?.email).toContain("@deleted.invalid");
    expect(account?.name).toBeNull();
  });

  it("purges tombstoned accounts only after the retention window", async () => {
    const userId = await createTestUser(sql);
    const deletedAt = new Date("2026-01-01T00:00:00.000Z");
    await deleteAccount(db, userId, deletedAt);

    expect(await purgeDeletedUsers(db, new Date("2026-01-15T00:00:00.000Z"))).toBe(0);
    expect(await purgeDeletedUsers(db, new Date("2026-02-15T00:00:00.000Z"))).toBe(1);

    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from users
    `;
    expect(row.count).toBe(0);
  });
});
