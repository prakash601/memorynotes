import { afterAll, beforeEach, expect, it } from "vitest";
import {
  GoneError,
  createApiToken,
  createNote,
  hardDeleteNote,
  listDeletedNotes,
  listNotes,
  publishNote,
  purgeDeletedNotes,
  resolveShare,
  restoreNote,
  softDeleteNote,
} from "@/core";
import { closeDb } from "@/db";
import { DELETE as deleteNoteRoute } from "@/app/api/v1/notes/[id]/route";
import { POST as restoreNoteRoute } from "@/app/api/v1/notes/[id]/restore/route";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

const BASE = "http://localhost:3000";

function ctx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

function apiRequest(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return new Request(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describeWithDatabase("trash service", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seed(overrides: { title?: string; content?: string } = {}) {
    const userId = await createTestUser(sql);
    const created = await createNote(db, {
      ownerId: userId,
      title: overrides.title ?? "Trash me",
      content: overrides.content ?? "# trash me",
    });
    return { userId, ...created };
  }

  it("round-trips through trash and back to the list", async () => {
    const { userId, note } = await seed();
    expect(await listNotes(db, userId)).toHaveLength(1);
    expect(await listDeletedNotes(db, userId)).toHaveLength(0);

    await softDeleteNote(db, { noteId: note.id, ownerId: userId });
    expect(await listNotes(db, userId)).toHaveLength(0);
    const trashed = await listDeletedNotes(db, userId);
    expect(trashed).toHaveLength(1);
    expect(trashed[0].id).toBe(note.id);
    expect(trashed[0].deletedAt).toBeInstanceOf(Date);

    const { note: restored } = await restoreNote(db, { noteId: note.id, ownerId: userId });
    expect(restored.deletedAt).toBeNull();
    expect(await listNotes(db, userId)).toHaveLength(1);
    expect(await listDeletedNotes(db, userId)).toHaveLength(0);
  });

  it("keeps the share link gone while trashed and issues a fresh one on restore", async () => {
    const { userId, note, rawToken } = await seed();
    await publishNote(db, { noteId: note.id, userId, message: "one" });

    await softDeleteNote(db, { noteId: note.id, ownerId: userId });
    await expect(resolveShare(db, rawToken)).rejects.toBeInstanceOf(GoneError);

    const { rawToken: newToken } = await restoreNote(db, { noteId: note.id, ownerId: userId });
    expect(newToken).not.toBe(rawToken);
    // The old link never comes back; the fresh link works.
    await expect(resolveShare(db, rawToken)).rejects.toBeInstanceOf(GoneError);
    expect((await resolveShare(db, newToken)).note.id).toBe(note.id);
  });

  it("restoring a live note is a 404", async () => {
    const { userId, note } = await seed();
    await expect(restoreNote(db, { noteId: note.id, ownerId: userId })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("purges only after the 30-day window with clock injection", async () => {
    const { userId, note } = await seed();
    await softDeleteNote(db, {
      noteId: note.id,
      ownerId: userId,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(await purgeDeletedNotes(db, new Date("2026-01-15T00:00:00.000Z"))).toBe(0);
    expect(await listDeletedNotes(db, userId)).toHaveLength(1);

    // Restoring before the window saves the note from the purge job.
    await restoreNote(db, { noteId: note.id, ownerId: userId });
    expect(await purgeDeletedNotes(db, new Date("2026-02-15T00:00:00.000Z"))).toBe(0);
    expect(await listNotes(db, userId)).toHaveLength(1);

    // Trashed again and left alone, the job deletes it after 30 days.
    await softDeleteNote(db, {
      noteId: note.id,
      ownerId: userId,
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(await purgeDeletedNotes(db, new Date("2026-03-20T00:00:00.000Z"))).toBe(0);
    expect(await purgeDeletedNotes(db, new Date("2026-04-05T00:00:00.000Z"))).toBe(1);
    const [remaining] = await sql<{ count: number }[]>`
      select count(*)::int as count from notes
    `;
    expect(remaining.count).toBe(0);
  });

  it("hard-deletes only trash contents and cascades", async () => {
    const { userId, note } = await seed();
    await publishNote(db, { noteId: note.id, userId, message: "one" });

    // A live note must go through trash first.
    await expect(hardDeleteNote(db, { noteId: note.id, ownerId: userId })).rejects.toMatchObject({
      code: "validation",
    });

    await softDeleteNote(db, { noteId: note.id, ownerId: userId });
    const deleted = await hardDeleteNote(db, { noteId: note.id, ownerId: userId });
    expect(deleted.id).toBe(note.id);
    expect(await listDeletedNotes(db, userId)).toHaveLength(0);
    const [counts] = await sql<{ notes: number; drafts: number; versions: number }[]>`
      select
        (select count(*) from notes)::int as notes,
        (select count(*) from note_drafts)::int as drafts,
        (select count(*) from note_versions)::int as versions
    `;
    expect(counts).toEqual({ notes: 0, drafts: 0, versions: 0 });
  });
});

describeWithDatabase("trash API", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seed() {
    const userId = await createTestUser(sql);
    const created = await createNote(db, { ownerId: userId, title: "Trash me", content: "x" });
    const { rawToken } = await createApiToken(db, {
      userId,
      name: "trash",
      scopes: ["notes:read", "notes:write", "notes:delete"],
    });
    return { userId, noteId: created.note.id, token: rawToken };
  }

  it("restores a trashed note with a fresh share", async () => {
    const { noteId, token } = await seed();
    await deleteNoteRoute(
      apiRequest(`/api/v1/notes/${noteId}`, { method: "DELETE", token }),
      ctx({ id: noteId }),
    );

    const res = await restoreNoteRoute(
      apiRequest(`/api/v1/notes/${noteId}/restore`, { method: "POST", token }),
      ctx({ id: noteId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(noteId);
    expect(body.deleted_at).toBeNull();
    expect(body.share.url).toContain("/n/");
  });

  it("keeps plain DELETE as soft-delete and confirms permanent DELETE", async () => {
    const { noteId, token } = await seed();

    // Plain DELETE still trashes.
    const trashed = await deleteNoteRoute(
      apiRequest(`/api/v1/notes/${noteId}`, { method: "DELETE", token }),
      ctx({ id: noteId }),
    );
    expect(trashed.status).toBe(200);
    expect((await trashed.json()).deleted_at).not.toBeNull();

    // Permanent DELETE of a live note is rejected; trash it first is already done.
    const gone = await deleteNoteRoute(
      apiRequest(`/api/v1/notes/${noteId}`, {
        method: "DELETE",
        token,
        body: { permanent: true, confirm: true },
      }),
      ctx({ id: noteId }),
    );
    expect(gone.status).toBe(200);
    expect(await gone.json()).toMatchObject({ id: noteId, permanently_deleted: true });
  });

  it("rejects permanent DELETE without confirmation", async () => {
    const { userId, noteId, token } = await seed();
    await deleteNoteRoute(
      apiRequest(`/api/v1/notes/${noteId}`, { method: "DELETE", token }),
      ctx({ id: noteId }),
    );

    const res = await deleteNoteRoute(
      apiRequest(`/api/v1/notes/${noteId}`, { method: "DELETE", token, body: { permanent: true } }),
      ctx({ id: noteId }),
    );
    // Missing confirm never hard-deletes: re-trashing an already-trashed note
    // is a 404 and the note stays in the trash.
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
    expect(await listDeletedNotes(db, userId)).toHaveLength(1);
  });
});
