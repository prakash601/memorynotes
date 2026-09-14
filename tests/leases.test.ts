import { afterAll, beforeEach, expect, it } from "vitest";
import {
  abortLease,
  acquireLease,
  commitLease,
  createNote,
  forceReleaseLease,
  getActiveLease,
  heartbeatLease,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("note leases", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seed() {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, { ownerId: userId, content: "# one" });
    return { userId, note };
  }

  it("acquires a lease and blocks a second live holder", async () => {
    const { userId, note } = await seed();
    const first = await acquireLease(db, { noteId: note.id, holderId: userId, holderType: "ai" });

    expect(first.leaseToken).toMatch(/^lz_/);
    expect(first.baseRevision).toBe(1);
    expect((await getActiveLease(db, note.id))?.noteId).toBe(note.id);

    await expect(
      acquireLease(db, { noteId: note.id, holderId: userId, holderType: "ai" }),
    ).rejects.toMatchObject({ code: "lease_held" });
  });

  it("renews on heartbeat and reports expiry after the ttl", async () => {
    const { userId, note } = await seed();
    const start = new Date("2026-09-14T10:00:00.000Z");
    const lease = await acquireLease(db, {
      noteId: note.id,
      holderId: userId,
      holderType: "ai",
      now: start,
      ttlSeconds: 60,
    });

    const renewed = await heartbeatLease(db, {
      noteId: note.id,
      leaseToken: lease.leaseToken,
      now: new Date(start.getTime() + 30_000),
      ttlSeconds: 60,
    });
    expect(renewed.expiresAt.toISOString()).toBe(new Date(start.getTime() + 90_000).toISOString());

    await expect(
      heartbeatLease(db, {
        noteId: note.id,
        leaseToken: lease.leaseToken,
        now: new Date(start.getTime() + 200_000),
      }),
    ).rejects.toMatchObject({ code: "lease_expired" });
  });

  it("replaces an expired lease on the next acquire", async () => {
    const { userId, note } = await seed();
    const start = new Date("2026-09-14T10:00:00.000Z");
    const first = await acquireLease(db, {
      noteId: note.id,
      holderId: userId,
      holderType: "ai",
      now: start,
      ttlSeconds: 60,
    });

    const second = await acquireLease(db, {
      noteId: note.id,
      holderId: userId,
      holderType: "ai",
      now: new Date(start.getTime() + 61_000),
    });
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(await getActiveLease(db, note.id, new Date(start.getTime() + 61_000))).not.toBeNull();
  });

  it("commits staged content into the draft and releases the lease", async () => {
    const { userId, note } = await seed();
    const lease = await acquireLease(db, { noteId: note.id, holderId: userId, holderType: "ai" });

    const result = await commitLease(db, {
      noteId: note.id,
      leaseToken: lease.leaseToken,
      mode: "stage",
      content: "# two",
    });

    expect(result.revision).toBe(2);
    expect(result.version).toBeNull();
    expect(await getActiveLease(db, note.id)).toBeNull();

    const [draft] = await sql<{ content: string }[]>`
      select content from note_drafts where note_id = ${note.id}
    `;
    expect(draft.content).toBe("# two");
  });

  it("publishes on commit when asked", async () => {
    const { userId, note } = await seed();
    const lease = await acquireLease(db, { noteId: note.id, holderId: userId, holderType: "ai" });

    const result = await commitLease(db, {
      noteId: note.id,
      leaseToken: lease.leaseToken,
      mode: "publish",
      content: "# published",
      message: "agent edit",
    });

    expect(result.version?.versionNumber).toBe(1);
    const [row] = await sql<{ published_version_id: string | null }[]>`
      select published_version_id from notes where id = ${note.id}
    `;
    expect(row.published_version_id).toBe(result.version?.id);
  });

  it("refuses a commit after the lease expires", async () => {
    const { userId, note } = await seed();
    const start = new Date("2026-09-14T10:00:00.000Z");
    const lease = await acquireLease(db, {
      noteId: note.id,
      holderId: userId,
      holderType: "ai",
      now: start,
      ttlSeconds: 60,
    });

    await expect(
      commitLease(db, {
        noteId: note.id,
        leaseToken: lease.leaseToken,
        mode: "stage",
        content: "# late",
        now: new Date(start.getTime() + 120_000),
      }),
    ).rejects.toMatchObject({ code: "lease_expired" });
  });

  it("leaves the note unchanged when a lease dies mid-edit", async () => {
    const { userId, note } = await seed();
    const start = new Date("2026-09-14T10:00:00.000Z");
    const lease = await acquireLease(db, {
      noteId: note.id,
      holderId: userId,
      holderType: "ai",
      now: start,
      ttlSeconds: 60,
    });

    // The agent stages an edit, then is killed; the commit never arrives.
    const afterExpiry = new Date(start.getTime() + 120_000);
    await commitLease(db, {
      noteId: note.id,
      leaseToken: lease.leaseToken,
      mode: "stage",
      content: "# rewritten by a dead agent",
      now: afterExpiry,
    }).catch(() => undefined);

    const [draft] = await sql<{ content: string; revision: number }[]>`
      select content, revision from note_drafts where note_id = ${note.id}
    `;
    expect(draft).toEqual({ content: "# one", revision: 1 });
    // The lease is gone on its own, with no cleanup call.
    expect(await getActiveLease(db, note.id, afterExpiry)).toBeNull();
    await expect(
      acquireLease(db, {
        noteId: note.id,
        holderId: userId,
        holderType: "ai",
        now: afterExpiry,
      }),
    ).resolves.toMatchObject({ baseRevision: 1 });
  });

  it("drops staging on abort", async () => {
    const { userId, note } = await seed();
    const lease = await acquireLease(db, { noteId: note.id, holderId: userId, holderType: "ai" });

    await abortLease(db, { noteId: note.id, leaseToken: lease.leaseToken });
    expect(await getActiveLease(db, note.id)).toBeNull();

    const [draft] = await sql<{ content: string; revision: number }[]>`
      select content, revision from note_drafts where note_id = ${note.id}
    `;
    expect(draft).toEqual({ content: "# one", revision: 1 });
  });

  it("lets only the owner force-release", async () => {
    const { userId, note } = await seed();
    const otherUserId = await createTestUser(sql, "other");
    await acquireLease(db, { noteId: note.id, holderId: userId, holderType: "ai" });

    await expect(
      forceReleaseLease(db, { noteId: note.id, ownerId: otherUserId }),
    ).rejects.toMatchObject({ code: "not_found" });

    await forceReleaseLease(db, { noteId: note.id, ownerId: userId });
    expect(await getActiveLease(db, note.id)).toBeNull();
  });
});
