import { afterAll, beforeEach, expect, it } from "vitest";
import {
  createNote,
  getOwnedNote,
  hashToken,
  listNotes,
  publishNote,
  purgeDeletedNotes,
  restoreVersion,
  softDeleteNote,
  updateDraft,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("notes service", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seed(overrides: { title?: string; content?: string } = {}) {
    const userId = await createTestUser(sql);
    const created = await createNote(db, {
      ownerId: userId,
      title: overrides.title ?? "Hello",
      content: overrides.content ?? "# Hello world",
    });
    return { userId, ...created };
  }

  it("creates the note, draft, and canonical share in one transaction", async () => {
    const { note, draft, share, rawToken } = await seed();

    expect(note.visibility).toBe("unlisted");
    expect(draft.revision).toBe(1);
    expect(draft.title).toBe("Hello");
    expect(share.access).toBe("view");
    expect(share.tokenHash).toBe(hashToken(rawToken));
    expect(share.tokenCiphertext).not.toContain(rawToken);

    const [counts] = await sql<{ notes: number; drafts: number; shares: number }[]>`
      select
        (select count(*) from notes)::int as notes,
        (select count(*) from note_drafts)::int as drafts,
        (select count(*) from note_shares)::int as shares
    `;
    expect(counts).toEqual({ notes: 1, drafts: 1, shares: 1 });
  });

  it("has no published version until the note is published", async () => {
    const { userId, note } = await seed();
    expect((await getOwnedNote(db, note.id, userId)).publishedVersion).toBeNull();

    await publishNote(db, { noteId: note.id, userId, message: "first" });
    const view = await getOwnedNote(db, note.id, userId);
    expect(view.publishedVersion?.versionNumber).toBe(1);
  });

  it("increments the revision on a successful save", async () => {
    const { userId, note, draft } = await seed();
    const updated = await updateDraft(db, {
      noteId: note.id,
      userId,
      content: "# Changed",
      baseRevision: draft.revision,
    });

    expect(updated.revision).toBe(2);
    expect(updated.content).toBe("# Changed");
  });

  it("rejects a stale save and reports the current revision", async () => {
    const { userId, note } = await seed();

    await expect(
      updateDraft(db, { noteId: note.id, userId, content: "stale", baseRevision: 99 }),
    ).rejects.toMatchObject({
      code: "conflict_revision",
      status: 409,
      details: { current_revision: 1 },
    });

    const [row] = await sql<{ revision: number }[]>`
      select revision from note_drafts where note_id = ${note.id}
    `;
    expect(row.revision).toBe(1);
  });

  it("rejects content over 1 MiB", async () => {
    const { userId, note, draft } = await seed();

    await expect(
      updateDraft(db, {
        noteId: note.id,
        userId,
        content: "x".repeat(1_048_577),
        baseRevision: draft.revision,
      }),
    ).rejects.toMatchObject({ code: "content_too_large" });
  });

  it("publishes sequentially numbered versions and never rewrites them", async () => {
    const { userId, note } = await seed();

    const first = await publishNote(db, { noteId: note.id, userId, message: "first" });
    const second = await publishNote(db, { noteId: note.id, userId, message: "second" });

    expect(first.versionNumber).toBe(1);
    expect(second.versionNumber).toBe(2);

    const [stored] = await sql<{ content: string; message: string }[]>`
      select content, message from note_versions where id = ${first.id}
    `;
    expect(stored.content).toBe(first.content);
    expect(stored.message).toBe("first");
  });

  it("rejects a publish whose base revision is stale", async () => {
    const { userId, note } = await seed();

    await expect(
      publishNote(db, { noteId: note.id, userId, baseRevision: 42 }),
    ).rejects.toMatchObject({ code: "conflict_revision" });
  });

  it("restores an old version by adding a new one", async () => {
    const { userId, note } = await seed({ content: "# one" });
    const v1 = await publishNote(db, { noteId: note.id, userId, message: "one" });

    await updateDraft(db, { noteId: note.id, userId, content: "# two", baseRevision: 1 });
    const v2 = await publishNote(db, { noteId: note.id, userId, message: "two" });

    const { version: v3, draft } = await restoreVersion(db, {
      noteId: note.id,
      userId,
      versionNumber: 1,
    });

    expect(v2.versionNumber).toBe(2);
    expect(v3.versionNumber).toBe(3);
    expect(v3.content).toBe("# one");
    expect(draft.content).toBe("# one");

    const rows = await sql<{ version_number: number }[]>`
      select version_number from note_versions where note_id = ${note.id} order by version_number
    `;
    expect(rows.map((row) => row.version_number)).toEqual([1, 2, 3]);

    const [original] = await sql<{ content: string }[]>`
      select content from note_versions where id = ${v1.id}
    `;
    expect(original.content).toBe("# one");
  });

  it("soft deletes, hides from the list, and purges only after the window", async () => {
    const { userId, note } = await seed();

    await softDeleteNote(db, {
      noteId: note.id,
      ownerId: userId,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(await listNotes(db, userId)).toHaveLength(0);

    expect(await purgeDeletedNotes(db, new Date("2026-01-15T00:00:00.000Z"))).toBe(0);
    expect(await purgeDeletedNotes(db, new Date("2026-02-15T00:00:00.000Z"))).toBe(1);

    const [remaining] = await sql<{ count: number }[]>`
      select count(*)::int as count from notes
    `;
    expect(remaining.count).toBe(0);
  });

  it("lists only the owner's own notes", async () => {
    const { userId } = await seed({ title: "Mine" });
    const otherUserId = await createTestUser(sql, "other");
    await createNote(db, { ownerId: otherUserId, title: "Theirs" });

    const mine = await listNotes(db, userId);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Mine");
    expect(mine[0].share?.rawToken).toHaveLength(22);
  });
});
