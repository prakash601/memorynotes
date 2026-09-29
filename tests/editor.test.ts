import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createApiToken,
  createNote,
  imageFingerprint,
  resolveDomainAccess,
  updateDraft,
  validateImageUpload,
} from "@/core";
import { closeDb } from "@/db";
import { renderMarkdown } from "@/lib/markdown";
import { GET as serveImage } from "@/app/uploads/[name]/route";
import { PATCH as updateNoteRoute } from "@/app/api/v1/notes/[id]/route";
import { POST as uploadImageRoute } from "@/app/api/v1/notes/[id]/images/route";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

const BASE = "http://localhost:3000";

function ctx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

// Minimal valid headers for each raster type.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

describe("editor markdown (GFM fixtures, no XSS)", () => {
  it("renders task lists as disabled checkboxes", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done\n");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).not.toContain("onclick");
  });

  it("handles the GFM fixture block: tables, strikethrough, autolinks", () => {
    const html = renderMarkdown(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~\n\nhttps://example.com\n\n```py\nprint(1)\n```\n",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('class="language-py"');
  });

  it("strips XSS while keeping the text", () => {
    const html = renderMarkdown(
      "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))\n\n<svg onload=alert(1)></svg>\n",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onload");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<svg");
  });

  it("keeps our own uploads inline and external images as links", () => {
    const html = renderMarkdown(
      "![alt](/uploads/1234-5678.png)\n\n![ext](https://example.com/a.png)\n",
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="/uploads/1234-5678.png"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("[image: ext]");
    expect(html).not.toContain('<img src="https://example.com');
  });

  it("honors the app origin for absolute image URLs", () => {
    const mine = renderMarkdown("![a](https://notes.example.com/uploads/x.png)", {
      appOrigin: "https://notes.example.com",
    });
    expect(mine).toContain("<img");
    const theirs = renderMarkdown("![a](https://notes.example.com/uploads/x.png)", {
      appOrigin: "https://other.example.com",
    });
    expect(theirs).not.toContain("<img");
    expect(theirs).toContain("[image: a]");
  });
});

describe("image upload validation", () => {
  it("accepts genuine raster stills", () => {
    expect(validateImageUpload(PNG, "image/png")).toMatchObject({
      contentType: "image/png",
      extension: "png",
    });
    expect(validateImageUpload(JPEG, "image/jpeg")).toMatchObject({ extension: "jpg" });
    expect(validateImageUpload(GIF, "image/gif")).toMatchObject({ extension: "gif" });
    expect(validateImageUpload(WEBP, "image/webp")).toMatchObject({ extension: "webp" });
  });

  it("rejects executables, SVGs, empties, mismatches, and oversize files", () => {
    expect(() => validateImageUpload(EXE, "image/png")).toThrowError(/match|Unsupported/);
    expect(() => validateImageUpload(EXE, "application/x-msdownload")).toThrowError(/Unsupported/);
    expect(() => validateImageUpload(SVG, "image/svg+xml")).toThrowError(/Unsupported/);
    expect(() => validateImageUpload(new Uint8Array(), "image/png")).toThrowError(/empty/);
    expect(() => validateImageUpload(PNG, "image/jpeg")).toThrowError(/match/);
    expect(() => validateImageUpload(new Uint8Array(6 * 1024 * 1024), "image/png")).toThrowError(
      /5 MiB/,
    );
  });
});

describeWithDatabase("image upload and serving", () => {
  const { sql, db } = createTestContext();

  beforeAll(() => {
    process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), "notesapp-uploads-"));
  });

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seed() {
    const userId = await createTestUser(sql);
    const created = await createNote(db, { ownerId: userId, title: "Pics", content: "x" });
    const { rawToken } = await createApiToken(db, {
      userId,
      name: "pics",
      scopes: ["notes:read", "notes:write"],
    });
    return { noteId: created.note.id, token: rawToken };
  }

  function uploadRequest(
    noteId: string,
    options: { token?: string; file?: File | null; idempotencyKey?: string } = {},
  ): Request {
    const headers: Record<string, string> = {};
    if (options.token) {
      headers.authorization = `Bearer ${options.token}`;
    }
    if (options.idempotencyKey) {
      headers["idempotency-key"] = options.idempotencyKey;
    }
    const form = new FormData();
    if (options.file !== null) {
      form.append(
        "file",
        options.file ??
          new File([PNG as Uint8Array<ArrayBuffer>], "tiny.png", { type: "image/png" }),
      );
    }
    return new Request(`${BASE}/api/v1/notes/${noteId}/images`, {
      method: "POST",
      headers,
      body: form,
    });
  }

  it("requires auth and a file", async () => {
    const { noteId } = await seed();
    // An invalid bearer token exercises the 401 path (the cookie-session path
    // needs the Next.js runtime, so it is covered in production, not vitest).
    const anon = await uploadImageRoute(
      uploadRequest(noteId, { token: "mn_bogus" }),
      ctx({ id: noteId }),
    );
    expect(anon.status).toBe(401);
    const { token } = await seed();
    const noFile = await uploadImageRoute(
      uploadRequest(noteId, { token, file: null }),
      ctx({ id: noteId }),
    );
    expect(noFile.status).toBe(422);
  });

  it("rejects executables and scriptable SVGs", async () => {
    const { noteId, token } = await seed();
    for (const [name, type, bytes] of [
      ["evil.exe", "application/x-msdownload", EXE],
      ["evil.png", "image/png", EXE],
      ["vector.svg", "image/svg+xml", SVG],
    ] as const) {
      const res = await uploadImageRoute(
        uploadRequest(noteId, {
          token,
          file: new File([bytes as Uint8Array<ArrayBuffer>], name, { type }),
        }),
        ctx({ id: noteId }),
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "validation" });
    }
  });

  it("stores the upload and serves it back as an image", async () => {
    const { noteId, token } = await seed();
    const res = await uploadImageRoute(uploadRequest(noteId, { token }), ctx({ id: noteId }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string; content_type: string };
    expect(body.content_type).toBe("image/png");
    expect(body.url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);

    const name = body.url.replace("/uploads/", "");
    const served = await serveImage(new Request(`${BASE}${body.url}`), ctx({ name }));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("replays a retried upload instead of storing it twice", async () => {
    const { noteId, token } = await seed();
    const options = { token, idempotencyKey: "upload-once-1" };

    const first = await uploadImageRoute(uploadRequest(noteId, options), ctx({ id: noteId }));
    expect(first.status).toBe(201);
    expect(first.headers.get("ratelimit-limit")).toBe("100");
    const firstBody = await first.text();

    const second = await uploadImageRoute(uploadRequest(noteId, options), ctx({ id: noteId }));
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotency-replayed")).toBe("true");
    expect(await second.text()).toBe(firstBody);

    const [count] = await sql<{ count: number }[]>`
      select count(*)::int as count from note_images where note_id = ${noteId}
    `;
    expect(count.count).toBe(1);
  });

  it("rejects a different file under the same idempotency key", async () => {
    const { noteId, token } = await seed();
    const key = "upload-conflict-1";
    const first = await uploadImageRoute(
      uploadRequest(noteId, { token, idempotencyKey: key }),
      ctx({ id: noteId }),
    );
    expect(first.status).toBe(201);

    const other = await uploadImageRoute(
      uploadRequest(noteId, {
        token,
        idempotencyKey: key,
        file: new File([JPEG as Uint8Array<ArrayBuffer>], "other.jpg", { type: "image/jpeg" }),
      }),
      ctx({ id: noteId }),
    );
    expect(other.status).toBe(422);
    expect(await other.json()).toMatchObject({ code: "validation" });
  });

  it("fingerprints the exact bytes, not just the note", () => {
    expect(imageFingerprint("n1", PNG)).toBe(imageFingerprint("n1", PNG));
    expect(imageFingerprint("n1", PNG)).not.toBe(imageFingerprint("n1", JPEG));
    expect(imageFingerprint("n1", PNG)).not.toBe(imageFingerprint("n2", PNG));
  });

  it("serves a missing image as 404", async () => {
    const missing = await serveImage(
      new Request(`${BASE}/uploads/00000000-0000-4000-8000-000000000000.png`),
      ctx({
        name: "00000000-0000-4000-8000-000000000000.png",
      }),
    );
    expect(missing.status).toBe(404);
    const evil = await serveImage(
      new Request(`${BASE}/uploads/../../etc/passwd`),
      ctx({ name: "../../etc/passwd" }),
    );
    expect(evil.status).toBe(404);
  });
});

describeWithDatabase("draft conflicts keep the 409 path", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  it("rejects a stale autosave with conflict_revision", async () => {
    const userId = await createTestUser(sql);
    const created = await createNote(db, { ownerId: userId, title: "Race", content: "v1" });
    const { rawToken } = await createApiToken(db, {
      userId,
      name: "race",
      scopes: ["notes:read", "notes:write"],
    });

    // A concurrent edit moves the draft forward first.
    await updateDraft(db, {
      noteId: created.note.id,
      userId,
      title: "Race",
      content: "v2",
      baseRevision: 1,
    });

    const res = await updateNoteRoute(
      new Request(`${BASE}/api/v1/notes/${created.note.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${rawToken}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Race", content: "stale", base_revision: 1 }),
      }),
      ctx({ id: created.note.id }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict_revision" });
  });
});

describe("upload paths on the share host", () => {
  it("serves /uploads from either host without redirecting", () => {
    const config = {
      appUrl: "https://app.example.com",
      shareDomain: "https://share.example.com",
    };
    const decision = resolveDomainAccess({
      ...config,
      host: "share.example.com",
      pathname: "/uploads/12345678-1234-1234-1234-123456789012.png",
    });
    expect(decision).toEqual({ action: "allow" });
  });
});
