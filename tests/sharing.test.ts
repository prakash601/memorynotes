import { afterAll, beforeEach, expect, it } from "vitest";
import {
  GoneError,
  NotFoundError,
  assertCanEdit,
  createNote,
  getOrCreateShare,
  publishNote,
  resolveShare,
  revokeShare,
  rotateShare,
  softDeleteNote,
  updateShare,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("sharing service", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seedPublished() {
    const userId = await createTestUser(sql);
    const { note, rawToken } = await createNote(db, {
      ownerId: userId,
      title: "Shared",
      content: "# Body",
    });
    const version = await publishNote(db, { noteId: note.id, userId });
    return { userId, note, rawToken, version };
  }

  it("resolves a published note by token without an account", async () => {
    const { note, rawToken, version } = await seedPublished();

    const resolved = await resolveShare(db, rawToken);
    expect(resolved.note.id).toBe(note.id);
    expect(resolved.version.id).toBe(version.id);
    expect(resolved.version.content).toBe("# Body");
  });

  it("throws not found for an unknown token", async () => {
    await expect(resolveShare(db, "not-a-real-token")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is gone when the note was never published", async () => {
    const userId = await createTestUser(sql);
    const { rawToken } = await createNote(db, { ownerId: userId });

    await expect(resolveShare(db, rawToken)).rejects.toBeInstanceOf(GoneError);
  });

  it("is gone once the link has expired", async () => {
    const { rawToken } = await seedPublished();
    const past = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000);

    await expect(resolveShare(db, rawToken, past)).rejects.toBeInstanceOf(GoneError);
  });

  it("is gone after the link is revoked", async () => {
    const { userId, note, rawToken } = await seedPublished();
    await revokeShare(db, { noteId: note.id, ownerId: userId });

    await expect(resolveShare(db, rawToken)).rejects.toBeInstanceOf(GoneError);
  });

  it("is gone after the note is soft deleted", async () => {
    const { userId, note, rawToken } = await seedPublished();
    await softDeleteNote(db, { noteId: note.id, ownerId: userId });

    await expect(resolveShare(db, rawToken)).rejects.toBeInstanceOf(GoneError);
  });

  it("rotates to a new token and kills the old one", async () => {
    const { userId, note, rawToken: oldToken } = await seedPublished();

    const { rawToken: newToken } = await rotateShare(db, {
      noteId: note.id,
      ownerId: userId,
    });

    expect(newToken).not.toBe(oldToken);
    await expect(resolveShare(db, oldToken)).rejects.toBeInstanceOf(GoneError);
    expect((await resolveShare(db, newToken)).note.id).toBe(note.id);

    const [active] = await sql<{ count: number }[]>`
      select count(*)::int as count from note_shares
      where note_id = ${note.id} and revoked_at is null
    `;
    expect(active.count).toBe(1);
  });

  it("returns the existing token instead of creating a second link", async () => {
    const { userId, note, rawToken } = await seedPublished();

    const again = await getOrCreateShare(db, { noteId: note.id, ownerId: userId });
    expect(again.rawToken).toBe(rawToken);
  });

  it("updates access and expiry", async () => {
    const { userId, note } = await seedPublished();

    const updated = await updateShare(db, {
      noteId: note.id,
      ownerId: userId,
      access: "edit",
      expiresIn: "7d",
    });

    expect(updated.access).toBe("edit");
    expect(updated.expiresAt).not.toBeNull();
  });

  it("rejects an unknown access level", async () => {
    const { userId, note } = await seedPublished();

    await expect(
      updateShare(db, { noteId: note.id, ownerId: userId, access: "admin" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("grants edit only via ownership or a live edit-capable link", async () => {
    const { userId, note, rawToken } = await seedPublished();
    const editorId = await createTestUser(sql, "editor");

    await expect(assertCanEdit(db, { noteId: note.id, userId: editorId })).rejects.toMatchObject({
      code: "forbidden",
    });

    await updateShare(db, { noteId: note.id, ownerId: userId, access: "edit" });
    await expect(
      assertCanEdit(db, { noteId: note.id, userId: editorId, shareToken: rawToken }),
    ).resolves.toBeTruthy();

    await updateShare(db, { noteId: note.id, ownerId: userId, access: "view" });
    await expect(
      assertCanEdit(db, { noteId: note.id, userId: editorId, shareToken: rawToken }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
