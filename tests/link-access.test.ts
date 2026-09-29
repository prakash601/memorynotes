import { afterAll, beforeEach, expect, it } from "vitest";
import {
  GoneError,
  createApiToken,
  createNote,
  hashSharePassword,
  publishNote,
  resolveShare,
  setShareMaxViews,
  setSharePassword,
  verifySharePassword,
} from "@/core";
import { closeDb } from "@/db";
import { GET as publicJsonRoute } from "@/app/api/v1/public/notes/[token]/route";
import { GET as shareRoute, PATCH as updateShareRoute } from "@/app/api/v1/notes/[id]/share/route";
import { GET as readGet, POST as readPost } from "@/app/n/[token]/route";
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

function readRequest(token: string, password?: string): Request {
  if (password === undefined) {
    return new Request(`${BASE}/n/${token}`);
  }
  return new Request(`${BASE}/n/${token}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }).toString(),
  });
}

describeWithDatabase("link passwords", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seedPublished() {
    const userId = await createTestUser(sql);
    const created = await createNote(db, { ownerId: userId, title: "Secret", content: "# secret" });
    await publishNote(db, { noteId: created.note.id, userId, message: "one" });
    return { userId, noteId: created.note.id, rawToken: created.rawToken };
  }

  it("hashes and verifies with a constant-time check", async () => {
    const hash = await hashSharePassword("correct horse");
    expect(hash).not.toContain("correct horse");
    expect(await verifySharePassword("correct horse", hash)).toBe(true);
    expect(await verifySharePassword("wrong horse", hash)).toBe(false);
    expect(await verifySharePassword("correct horse", "garbage")).toBe(false);
  });

  it("rejects empty passwords", async () => {
    const { userId, noteId } = await seedPublished();
    await expect(
      setSharePassword(db, { noteId, ownerId: userId, password: "" }),
    ).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("gates reads: missing password and wrong password are 401-shaped", async () => {
    const { userId, noteId, rawToken } = await seedPublished();
    await setSharePassword(db, { noteId, ownerId: userId, password: "s3cret!" });

    await expect(resolveShare(db, rawToken)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      resolveShare(db, rawToken, new Date(), { password: "nope" }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    const ok = await resolveShare(db, rawToken, new Date(), { password: "s3cret!" });
    expect(ok.note.id).toBe(noteId);
  });

  it("removing the password restores open reads", async () => {
    const { userId, noteId, rawToken } = await seedPublished();
    await setSharePassword(db, { noteId, ownerId: userId, password: "s3cret!" });
    await setSharePassword(db, { noteId, ownerId: userId, password: null });
    expect((await resolveShare(db, rawToken)).note.id).toBe(noteId);
  });
});

describeWithDatabase("view limits and view-once links", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seedPublished() {
    const userId = await createTestUser(sql);
    const created = await createNote(db, { ownerId: userId, title: "Burner", content: "# burner" });
    await publishNote(db, { noteId: created.note.id, userId, message: "one" });
    return { userId, noteId: created.note.id, rawToken: created.rawToken };
  }

  it("burns a view-once link on the first successful read", async () => {
    const { noteId, rawToken, userId } = await seedPublished();
    await setShareMaxViews(db, { noteId, ownerId: userId, maxViews: 1 });
    expect((await resolveShare(db, rawToken)).share.viewsCount).toBe(1);
    await expect(resolveShare(db, rawToken)).rejects.toBeInstanceOf(GoneError);
  });

  it("allows exactly maxViews reads, then gone", async () => {
    const { userId, noteId, rawToken } = await seedPublished();
    await setShareMaxViews(db, { noteId, ownerId: userId, maxViews: 2 });
    expect((await resolveShare(db, rawToken)).share.viewsCount).toBe(1);
    expect((await resolveShare(db, rawToken)).share.viewsCount).toBe(2);
    await expect(resolveShare(db, rawToken)).rejects.toBeInstanceOf(GoneError);
  });

  it("rejects invalid limits and clears them with null", async () => {
    const { userId, noteId, rawToken } = await seedPublished();
    await expect(
      setShareMaxViews(db, { noteId, ownerId: userId, maxViews: 0 }),
    ).rejects.toMatchObject({
      code: "validation",
    });
    await setShareMaxViews(db, { noteId, ownerId: userId, maxViews: 1 });
    await setShareMaxViews(db, { noteId, ownerId: userId, maxViews: null });
    expect((await resolveShare(db, rawToken)).share.viewsCount).toBe(0);
    expect((await resolveShare(db, rawToken)).share.viewsCount).toBe(0);
  });

  it("does not burn views on wrong passwords, and exempts the owner", async () => {
    const { userId, noteId, rawToken } = await seedPublished();
    await setSharePassword(db, { noteId, ownerId: userId, password: "s3cret!" });
    await setShareMaxViews(db, { noteId, ownerId: userId, maxViews: 1 });

    await expect(
      resolveShare(db, rawToken, new Date(), { password: "nope" }),
    ).rejects.toMatchObject({ code: "unauthorized" });

    // Owner previews never consume views.
    const exempt = { password: "s3cret!", exemptOwnerId: userId };
    expect((await resolveShare(db, rawToken, new Date(), exempt)).share.viewsCount).toBe(0);
    expect((await resolveShare(db, rawToken, new Date(), exempt)).share.viewsCount).toBe(0);

    // The wrong guess above did not burn the single view.
    expect(
      (await resolveShare(db, rawToken, new Date(), { password: "s3cret!" })).share.viewsCount,
    ).toBe(1);
    await expect(
      resolveShare(db, rawToken, new Date(), { password: "s3cret!" }),
    ).rejects.toBeInstanceOf(GoneError);
  });
});

describeWithDatabase("link-access API and read pages", () => {
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
    const created = await createNote(db, { ownerId: userId, title: "Links", content: "# links" });
    await publishNote(db, { noteId: created.note.id, userId, message: "one" });
    const { rawToken } = await createApiToken(db, {
      userId,
      name: "links",
      scopes: ["notes:read", "notes:share"],
    });
    return { userId, noteId: created.note.id, rawToken: created.rawToken, token: rawToken };
  }

  it("sets password and view limit through the share API", async () => {
    const { noteId, token } = await seed();
    const updated = await updateShareRoute(
      apiRequest(`/api/v1/notes/${noteId}/share`, {
        method: "PATCH",
        token,
        body: { password: "s3cret!", max_views: 1 },
      }),
      ctx({ id: noteId }),
    );
    expect(updated.status).toBe(200);

    const view = await shareRoute(
      apiRequest(`/api/v1/notes/${noteId}/share`, { token }),
      ctx({ id: noteId }),
    );
    expect(await view.json()).toMatchObject({
      share: { passwordProtected: true, maxViews: 1, viewsCount: 0 },
    });
  });

  it("serves public JSON only with the password once set", async () => {
    const { noteId, token, rawToken } = await seed();
    await updateShareRoute(
      apiRequest(`/api/v1/notes/${noteId}/share`, {
        method: "PATCH",
        token,
        body: { password: "s3cret!" },
      }),
      ctx({ id: noteId }),
    );

    const denied = await publicJsonRoute(
      apiRequest(`/api/v1/public/notes/${rawToken}`),
      ctx({ token: rawToken }),
    );
    expect(denied.status).toBe(401);

    const allowed = await publicJsonRoute(
      apiRequest(`/api/v1/public/notes/${rawToken}?password=${encodeURIComponent("s3cret!")}`),
      ctx({ token: rawToken }),
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ title: "Links" });
  });

  it("prompts for the password on the read page and burns view-once links", async () => {
    const { noteId, token, rawToken } = await seed();
    await updateShareRoute(
      apiRequest(`/api/v1/notes/${noteId}/share`, {
        method: "PATCH",
        token,
        body: { password: "s3cret!", max_views: 1 },
      }),
      ctx({ id: noteId }),
    );

    const prompt = await readGet(readRequest(rawToken), ctx({ token: rawToken }));
    expect(prompt.status).toBe(401);
    expect(await prompt.text()).toContain("Password required");

    const wrong = await readPost(readRequest(rawToken, "nope"), ctx({ token: rawToken }));
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("Incorrect password");

    const first = await readPost(readRequest(rawToken, "s3cret!"), ctx({ token: rawToken }));
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("Links");

    const second = await readPost(readRequest(rawToken, "s3cret!"), ctx({ token: rawToken }));
    expect(second.status).toBe(410);
  });

  it("rate-limits password brute force with 429", async () => {
    const { noteId, token, rawToken } = await seed();
    await updateShareRoute(
      apiRequest(`/api/v1/notes/${noteId}/share`, {
        method: "PATCH",
        token,
        body: { password: "s3cret!" },
      }),
      ctx({ id: noteId }),
    );

    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await readPost(readRequest(rawToken, `guess-${i}`), ctx({ token: rawToken }));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
