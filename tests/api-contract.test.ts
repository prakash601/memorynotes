import { afterAll, beforeEach, expect, it } from "vitest";
import { closeDb } from "@/db";
import { createApiToken } from "@/core";
import { GET as listNotes, POST as createNote } from "@/app/api/v1/notes/route";
import {
  DELETE as deleteFolderRoute,
  PATCH as updateFolderRoute,
} from "@/app/api/v1/folders/[id]/route";
import { GET as listFoldersRoute, POST as createFolderRoute } from "@/app/api/v1/folders/route";
import { GET as getNoteRoute, PATCH as updateNoteRoute } from "@/app/api/v1/notes/[id]/route";
import { POST as publishRoute } from "@/app/api/v1/notes/[id]/publish/route";
import { POST as acquireLeaseRoute } from "@/app/api/v1/notes/[id]/lease/route";
import { POST as commitLeaseRoute } from "@/app/api/v1/notes/[id]/lease/commit/route";
import { GET as publicNoteRoute } from "@/app/api/v1/public/notes/[token]/route";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

function ctx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

interface CallOptions {
  method?: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  url?: string;
}

const BASE = "http://localhost:3000";

function apiRequest(path: string, options: CallOptions = {}): Request {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }
  return new Request(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describeWithDatabase("/api/v1 contract", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function tokenFor(userId: string, scopes: string[]): Promise<string> {
    const { rawToken } = await createApiToken(db, {
      userId,
      name: "contract",
      scopes,
    });
    return rawToken;
  }

  it("rejects an invalid bearer token with problem+json", async () => {
    const response = await listNotes(apiRequest("/api/v1/notes", { token: "mn_bogus" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
  });

  it("lets a notes:read token read but not write", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read"]);

    const read = await listNotes(apiRequest("/api/v1/notes", { token }));
    expect(read.status).toBe(200);

    const write = await createNote(
      apiRequest("/api/v1/notes", {
        method: "POST",
        token,
        body: { title: "Nope" },
      }),
    );
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ code: "forbidden" });
  });

  it("creates a note and returns a working share url", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);

    const response = await createNote(
      apiRequest("/api/v1/notes", {
        method: "POST",
        token,
        body: { title: "Contract", content: "# Body" },
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; share: { url: string } };
    expect(body.share.url).toContain("/n/");
  });

  it("replays an idempotent create and does not double-apply", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:write"]);
    const options: CallOptions = {
      method: "POST",
      token,
      body: { title: "Once" },
      idempotencyKey: "key-create-1",
    };

    const first = await createNote(apiRequest("/api/v1/notes", options));
    expect(first.status).toBe(201);
    const firstBody = await first.text();

    const second = await createNote(apiRequest("/api/v1/notes", options));
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotency-replayed")).toBe("true");
    expect(await second.text()).toBe(firstBody);

    const [count] = await sql<{ count: number }[]>`
      select count(*)::int as count from notes
    `;
    expect(count.count).toBe(1);

    const conflicting = await createNote(
      apiRequest("/api/v1/notes", {
        ...options,
        body: { title: "Different" },
      }),
    );
    expect(conflicting.status).toBe(422);
  });

  it("paginates notes stably across pages", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);
    for (let index = 0; index < 3; index += 1) {
      await createNote(
        apiRequest("/api/v1/notes", {
          method: "POST",
          token,
          body: { title: `Note ${index}` },
        }),
      );
    }

    const firstPage = (await (
      await listNotes(apiRequest("/api/v1/notes?limit=2", { token }))
    ).json()) as { data: Array<{ id: string }>; next_cursor: string | null };
    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.next_cursor).not.toBeNull();

    const secondPage = (await (
      await listNotes(
        apiRequest(`/api/v1/notes?limit=2&cursor=${firstPage.next_cursor}`, { token }),
      )
    ).json()) as { data: Array<{ id: string }>; next_cursor: string | null };
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.next_cursor).toBeNull();

    const ids = [...firstPage.data, ...secondPage.data].map((note) => note.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("serves the published version as public JSON", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write", "notes:publish"]);

    const created = (await (
      await createNote(
        apiRequest("/api/v1/notes", {
          method: "POST",
          token,
          body: { title: "Public", content: "# Hello" },
        }),
      )
    ).json()) as { id: string; share: { url: string } };
    const shareToken = created.share.url.split("/n/")[1];

    await publishRoute(
      apiRequest(`/api/v1/notes/${created.id}/publish`, {
        method: "POST",
        token,
        body: { message: "first" },
      }),
      ctx({ id: created.id }),
    );

    const response = await publicNoteRoute(
      apiRequest(`/api/v1/public/notes/${shareToken}`),
      ctx({ token: shareToken }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "Public",
      content: "# Hello",
      version_number: 1,
    });

    const ownerView = await getNoteRoute(
      apiRequest(`/api/v1/notes/${created.id}`, { token }),
      ctx({ id: created.id }),
    );
    expect(ownerView.status).toBe(200);
  });

  it("runs a lease from acquire to commit", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);

    const created = (await (
      await createNote(
        apiRequest("/api/v1/notes", {
          method: "POST",
          token,
          body: { title: "Agent", content: "# start" },
        }),
      )
    ).json()) as { id: string };

    const acquired = (await (
      await acquireLeaseRoute(
        apiRequest(`/api/v1/notes/${created.id}/lease`, {
          method: "POST",
          token,
          body: { ttl_seconds: 60, holder_type: "ai" },
        }),
        ctx({ id: created.id }),
      )
    ).json()) as { lease_token: string; base_revision: number };
    expect(acquired.base_revision).toBe(1);
    expect(acquired.lease_token).toMatch(/^lz_/);

    const commit = await commitLeaseRoute(
      apiRequest(`/api/v1/notes/${created.id}/lease/commit`, {
        method: "POST",
        token,
        idempotencyKey: "key-commit-1",
        body: { lease_token: acquired.lease_token, mode: "stage", content: "# agent wrote" },
      }),
      ctx({ id: created.id }),
    );
    expect(commit.status).toBe(200);
    expect(await commit.json()).toMatchObject({ revision: 2, published_version: null });

    const view = (await (
      await getNoteRoute(
        apiRequest(`/api/v1/notes/${created.id}`, { token }),
        ctx({ id: created.id }),
      )
    ).json()) as { draft: { content: string } };
    expect(view.draft.content).toBe("# agent wrote");
  });

  it("filters the list by text, tag, and favorites", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);

    const first = (await (
      await createNote(
        apiRequest("/api/v1/notes", {
          method: "POST",
          token,
          body: { title: "Grocery list", content: "buy milk" },
        }),
      )
    ).json()) as { id: string };
    const second = (await (
      await createNote(
        apiRequest("/api/v1/notes", {
          method: "POST",
          token,
          body: { title: "Work plan", content: "ship it" },
        }),
      )
    ).json()) as { id: string };

    async function patch(id: string, body: unknown) {
      const response = await updateNoteRoute(
        apiRequest(`/api/v1/notes/${id}`, { method: "PATCH", token, body }),
        ctx({ id }),
      );
      expect(response.status).toBe(200);
      return (await response.json()) as { tags: string[] | null };
    }

    await patch(first.id, { tags: ["home"], favorite: true });
    await patch(second.id, { tags: ["work"] });

    async function listIds(query: string) {
      const response = await listNotes(apiRequest(`/api/v1/notes${query}`, { token }));
      expect(response.status).toBe(200);
      const page = (await response.json()) as {
        data: Array<{ id: string; is_favorite: boolean; is_pinned: boolean; tags: string[] }>;
        next_cursor: string | null;
      };
      return page;
    }

    const byText = await listIds("?q=milk");
    expect(byText.data.map((note) => note.id)).toEqual([first.id]);

    const byTag = await listIds("?tag=work");
    expect(byTag.data.map((note) => note.id)).toEqual([second.id]);
    expect(byTag.data[0]?.tags).toEqual(["work"]);

    const favorites = await listIds("?favorite=1");
    expect(favorites.data.map((note) => note.id)).toEqual([first.id]);
    expect(favorites.data[0]?.is_favorite).toBe(true);

    const combined = await listIds("?tag=home&favorite=1");
    expect(combined.data.map((note) => note.id)).toEqual([first.id]);

    const detail = (await (
      await getNoteRoute(apiRequest(`/api/v1/notes/${first.id}`, { token }), ctx({ id: first.id }))
    ).json()) as { tags: string[]; is_favorite: boolean };
    expect(detail.tags).toEqual(["home"]);
    expect(detail.is_favorite).toBe(true);
  });

  it("rejects bad tags and pins notes to the top", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);

    const created = (await (
      await createNote(apiRequest("/api/v1/notes", { method: "POST", token, body: { title: "a" } }))
    ).json()) as { id: string };

    const badTags = await updateNoteRoute(
      apiRequest(`/api/v1/notes/${created.id}`, {
        method: "PATCH",
        token,
        body: { tags: ["has space"] },
      }),
      ctx({ id: created.id }),
    );
    expect(badTags.status).toBe(422);

    const pinned = await updateNoteRoute(
      apiRequest(`/api/v1/notes/${created.id}`, {
        method: "PATCH",
        token,
        body: { pinned: true },
      }),
      ctx({ id: created.id }),
    );
    expect(pinned.status).toBe(200);

    const page = (await (await listNotes(apiRequest("/api/v1/notes", { token }))).json()) as {
      data: Array<{ id: string; is_pinned: boolean }>;
    };
    expect(page.data[0]).toMatchObject({ id: created.id, is_pinned: true });
  });

  it("manages folders and moves notes over HTTP", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);

    async function createFolder(body: unknown) {
      const response = await createFolderRoute(
        apiRequest("/api/v1/folders", { method: "POST", token, body }),
      );
      expect(response.status).toBe(201);
      return (await response.json()) as { folder: { id: string; name: string } };
    }

    const { folder } = await createFolder({ name: "Work" });
    const renamed = await updateFolderRoute(
      apiRequest(`/api/v1/folders/${folder.id}`, {
        method: "PATCH",
        token,
        body: { name: "Play" },
      }),
      ctx({ id: folder.id }),
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ folder: { id: folder.id, name: "Play" } });

    const created = (await (
      await createNote(
        apiRequest("/api/v1/notes", {
          method: "POST",
          token,
          body: { title: "filed", folder_id: folder.id },
        }),
      )
    ).json()) as { id: string };

    const filtered = (await (
      await listNotes(apiRequest(`/api/v1/notes?folder_id=${folder.id}`, { token }))
    ).json()) as { data: Array<{ id: string; folder_id: string | null }> };
    expect(filtered.data.map((note) => note.id)).toEqual([created.id]);
    expect(filtered.data[0]?.folder_id).toBe(folder.id);

    const moved = await updateNoteRoute(
      apiRequest(`/api/v1/notes/${created.id}`, {
        method: "PATCH",
        token,
        body: { folder_id: null },
      }),
      ctx({ id: created.id }),
    );
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ folder_id: null });

    const foreign = await updateNoteRoute(
      apiRequest(`/api/v1/notes/${created.id}`, {
        method: "PATCH",
        token,
        body: { folder_id: "00000000-0000-0000-0000-000000000000" },
      }),
      ctx({ id: created.id }),
    );
    expect(foreign.status).toBe(404);

    const listed = (await (
      await listFoldersRoute(apiRequest("/api/v1/folders", { token }))
    ).json()) as { data: Array<{ id: string }> };
    expect(listed.data.map((entry) => entry.id)).toEqual([folder.id]);

    const deleted = await deleteFolderRoute(
      apiRequest(`/api/v1/folders/${folder.id}`, { method: "DELETE", token }),
      ctx({ id: folder.id }),
    );
    expect(deleted.status).toBe(200);

    const view = (await (
      await getNoteRoute(
        apiRequest(`/api/v1/notes/${created.id}`, { token }),
        ctx({ id: created.id }),
      )
    ).json()) as { id: string };
    expect(view.id).toBe(created.id);
  });
});
