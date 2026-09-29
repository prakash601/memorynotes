import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createApiToken,
  createNote,
  diffText,
  diffVersionToDraft,
  diffVersions,
  publishNote,
  updateDraft,
} from "@/core";
import { closeDb } from "@/db";
import { GET as diffRoute } from "@/app/api/v1/notes/[id]/versions/[n]/diff/route";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describe("version diff util (line-based, framework-free)", () => {
  it("returns an empty diff for identical versions", () => {
    const diff = diffText("# Hello\nworld\n", "# Hello\nworld\n");
    expect(diff.empty).toBe(true);
    expect(diff.hunks).toEqual([]);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it("reports added and removed lines", () => {
    const diff = diffText("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(diff.empty).toBe(false);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);
    expect(diff.hunks.length).toBeGreaterThan(0);
    const flat = diff.hunks.flatMap((h) => h.lines);
    expect(flat.some((l) => l.type === "add" && l.text === "B")).toBe(true);
    expect(flat.some((l) => l.type === "del" && l.text === "b")).toBe(true);
  });

  it("caps large versions with the 1MiB guard", () => {
    const big = "x".repeat(600_000);
    try {
      diffText(big, `${big}y`);
      expect.unreachable("diff should reject oversized inputs");
    } catch (error) {
      expect(error).toMatchObject({ code: "content_too_large" });
    }
  });
});

describeWithDatabase("version diff service", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seedTwoVersions() {
    const userId = await createTestUser(sql);
    const created = await createNote(db, {
      ownerId: userId,
      title: "Hello",
      content: "a\nb\nc\n",
    });
    await publishNote(db, { noteId: created.note.id, userId, message: "one" });
    await updateDraft(db, {
      noteId: created.note.id,
      userId,
      title: "Hello",
      content: "a\nB\nc\nd\n",
      baseRevision: 1,
    });
    await publishNote(db, { noteId: created.note.id, userId, message: "two" });
    return { userId, noteId: created.note.id };
  }

  it("diffs two versions and finds the change", async () => {
    const { userId, noteId } = await seedTwoVersions();
    const diff = await diffVersions(db, noteId, userId, 1, 2);
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
    expect(diff.content.empty).toBe(false);
    expect(diff.content.added).toBe(2);
    expect(diff.content.removed).toBe(1);
  });

  it("returns an empty diff for identical version numbers", async () => {
    const { userId, noteId } = await seedTwoVersions();
    const diff = await diffVersions(db, noteId, userId, 1, 1);
    expect(diff.content.empty).toBe(true);
    expect(diff.title.empty).toBe(true);
  });

  it("diffs a version against the current draft for the restore preview", async () => {
    const { userId, noteId } = await seedTwoVersions();
    await updateDraft(db, {
      noteId,
      userId,
      title: "Hello",
      content: "a\nB\nc\nd\ne extra\n",
      baseRevision: 2,
    });
    const diff = await diffVersionToDraft(db, noteId, userId, 1);
    expect(diff.fromVersion).toBe(1);
    expect(diff.toDraft).toBe(true);
    expect(diff.content.empty).toBe(false);
  });
});

describeWithDatabase("GET /api/v1/notes/:id/versions/:v/diff", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  function ctx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
    return { params: Promise.resolve(params) };
  }

  async function seed() {
    const userId = await createTestUser(sql);
    const created = await createNote(db, {
      ownerId: userId,
      title: "Hello",
      content: "a\nb\n",
    });
    await publishNote(db, { noteId: created.note.id, userId, message: "one" });
    await updateDraft(db, {
      noteId: created.note.id,
      userId,
      title: "Hello",
      content: "a\nB\n",
      baseRevision: 1,
    });
    const { rawToken } = await createApiToken(db, {
      userId,
      name: "diff",
      scopes: ["notes:read"],
    });
    return { noteId: created.note.id, token: rawToken };
  }

  it("returns the draft diff for the restore preview", async () => {
    const { noteId, token } = await seed();
    const res = await diffRoute(
      new Request(`http://localhost:3000/api/v1/notes/${noteId}/versions/1/diff?to=draft`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      ctx({ id: noteId, n: "1" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from_version).toBe(1);
    expect(body.to_draft).toBe(true);
    expect(body.content_diff.empty).toBe(false);
  });

  it("rejects a non-numeric version with validation", async () => {
    const { noteId, token } = await seed();
    const res = await diffRoute(
      new Request(`http://localhost:3000/api/v1/notes/${noteId}/versions/nope/diff`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      ctx({ id: noteId, n: "nope" }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "validation" });
  });
});
