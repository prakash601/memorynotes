import { describe, expect, it } from "vitest";
import { beginIdempotency, resetIdempotencyStore } from "@/lib/idempotency";
import {
  buildDraftSyncRequest,
  createMemoryDraftStore,
  enqueueDraft,
  flushQueue,
  type QueuedDraft,
} from "@/lib/offline-queue";

function entry(noteId = "note-1", key = "key-1"): QueuedDraft {
  return {
    key,
    noteId,
    title: "T",
    content: "C",
    baseRevision: 3,
    shareToken: null,
    queuedAt: Date.now(),
    attempts: 0,
  };
}

describe("offline draft queue (issue #84)", () => {
  it("coalesces multiple offline edits into one entry that syncs once", async () => {
    const store = createMemoryDraftStore();
    const first = await enqueueDraft(store, {
      noteId: "note-1",
      title: "v1",
      content: "one",
      baseRevision: 3,
      key: "stable-key",
    });
    const second = await enqueueDraft(store, {
      noteId: "note-1",
      title: "v2",
      content: "two",
      baseRevision: 3,
    });

    // Same stable idempotency key, latest content wins.
    expect(second.key).toBe("stable-key");
    expect(second.content).toBe("two");
    expect(await store.list()).toHaveLength(1);

    let calls = 0;
    const summary = await flushQueue(store, async (queued) => {
      calls += 1;
      expect(queued.key).toBe(first.key);
      expect(queued.content).toBe("two");
      return { status: "synced", revision: 4 };
    });

    expect(calls).toBe(1);
    expect(summary).toMatchObject({ synced: ["note-1"], conflicts: [], pending: [] });
    expect(await store.list()).toHaveLength(0);

    // A second flush is a no-op: the draft synced exactly once.
    let secondCalls = 0;
    await flushQueue(store, async () => {
      secondCalls += 1;
      return { status: "synced" };
    });
    expect(secondCalls).toBe(0);
  });

  it("surfaces conflicts so the editor can reuse the 409 reconcile path", async () => {
    const store = createMemoryDraftStore();
    await enqueueDraft(store, {
      noteId: "note-9",
      title: "T",
      content: "C",
      baseRevision: 1,
      key: "key-9",
    });
    const summary = await flushQueue(store, async () => ({ status: "conflict" }));
    expect(summary.conflicts).toEqual(["note-9"]);
    // Conflicted entries leave the queue; the editor shows its reload banner.
    expect(await store.list()).toHaveLength(0);
  });

  it("keeps entries queued when still offline", async () => {
    const store = createMemoryDraftStore();
    await enqueueDraft(store, {
      noteId: "note-2",
      title: "T",
      content: "C",
      baseRevision: 1,
      key: "key-2",
    });
    const summary = await flushQueue(store, async () => ({ status: "offline" }));
    expect(summary.pending).toEqual(["note-2"]);
    expect(await store.list()).toHaveLength(1);
  });

  it("builds a PATCH sync request carrying the idempotency key and base revision", () => {
    const request = buildDraftSyncRequest({ ...entry(), shareToken: "share-abc" });
    expect(request).toMatchObject({ url: "/api/v1/notes/note-1", method: "PATCH" });
    expect(request.headers["idempotency-key"]).toBe("key-1");
    expect(JSON.parse(request.body)).toMatchObject({
      title: "T",
      content: "C",
      base_revision: 3,
      share_token: "share-abc",
    });
  });
});

describe("double-submit guard (Idempotency-Key replay)", () => {
  function writeRequest(key: string, body: string): Request {
    return new Request("http://localhost:3000/api/v1/notes", {
      method: "POST",
      headers: { "idempotency-key": key, "content-type": "application/json" },
      body,
    });
  }

  it("replays the original response instead of double-applying", async () => {
    resetIdempotencyStore();
    const principal = { userId: "user-1" };
    const body = JSON.stringify({ title: "Once" });

    const first = await beginIdempotency(writeRequest("double-submit-key", body), principal, body);
    expect(first.replay).toBeNull();
    const { NextResponse } = await import("next/server");
    const created = NextResponse.json({ id: "note-1" }, { status: 201 });
    await first.complete(created);

    const retry = await beginIdempotency(writeRequest("double-submit-key", body), principal, body);
    expect(retry.replay).not.toBeNull();
    expect(retry.replay!.headers.get("idempotency-replayed")).toBe("true");
    expect(retry.replay!.status).toBe(201);
    expect(await retry.replay!.json()).toMatchObject({ id: "note-1" });
  });

  it("rejects the same key with a different body", async () => {
    resetIdempotencyStore();
    const principal = { userId: "user-1" };
    const body = JSON.stringify({ title: "Once" });
    const first = await beginIdempotency(writeRequest("reuse-key", body), principal, body);
    const { NextResponse } = await import("next/server");
    await first.complete(NextResponse.json({ id: "note-1" }, { status: 201 }));

    const other = JSON.stringify({ title: "Different" });
    await expect(
      beginIdempotency(writeRequest("reuse-key", other), principal, other),
    ).rejects.toThrowError(/different request body/);
  });
});
