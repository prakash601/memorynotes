import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  noteDrafts,
  noteLeases,
  noteVersions,
  notes,
  type NoteLease,
  type NoteVersion,
} from "@/db/schema";
import { LEASE_TTL_SECONDS } from "./constants";
import {
  ConflictRevisionError,
  LeaseExpiredError,
  LeaseHeldError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { runModeration, type Moderator } from "./moderation";
import { requireOwnedNote } from "./notes";
import { hashToken } from "./tokens";
import { assertContentSize, normalizeContent, normalizeTitle } from "./validation";

export type LeaseHolderType = "user" | "ai" | "platform";
export type LeaseCommitMode = "stage" | "publish";

function generateLeaseToken(): string {
  return `lz_${randomBytes(24).toString("base64url")}`;
}

/** The live lease for a note, or null when none exists or it has expired. */
export async function getActiveLease(
  db: Database,
  noteId: string,
  now: Date = new Date(),
): Promise<NoteLease | null> {
  const [lease] = await db.select().from(noteLeases).where(eq(noteLeases.noteId, noteId)).limit(1);
  if (!lease || lease.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  return lease;
}

export interface AcquireLeaseInput {
  noteId: string;
  holderId: string;
  holderType: LeaseHolderType;
  clientId?: string | null;
  ttlSeconds?: number;
  now?: Date;
}

export interface ActiveLeaseView {
  lease: NoteLease;
  leaseToken: string;
  baseRevision: number;
  expiresAt: Date;
}

/**
 * Acquires the one lease per note (ADR-0004). A live lease blocks a second
 * holder; an expired lease is simply replaced, so a crashed agent never leaves
 * a stuck lock.
 */
export async function acquireLease(
  db: Database,
  input: AcquireLeaseInput,
): Promise<ActiveLeaseView> {
  const now = input.now ?? new Date();
  const ttl = input.ttlSeconds ?? LEASE_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 3_600) {
    throw new ValidationError("ttl_seconds must be between 1 and 3600");
  }

  const [note] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, input.noteId), isNull(notes.deletedAt)))
    .limit(1);
  if (!note) {
    throw new NotFoundError("Note not found");
  }

  const [draft] = await db
    .select()
    .from(noteDrafts)
    .where(eq(noteDrafts.noteId, input.noteId))
    .limit(1);
  if (!draft) {
    throw new NotFoundError("Draft not found");
  }

  const existing = await getActiveLease(db, input.noteId, now);
  if (existing) {
    throw new LeaseHeldError();
  }

  const rawToken = generateLeaseToken();
  const expiresAt = new Date(now.getTime() + ttl * 1_000);
  const values = {
    noteId: input.noteId,
    holderId: input.holderId,
    holderType: input.holderType,
    clientId: input.clientId ?? null,
    tokenHash: hashToken(rawToken),
    baseRevision: draft.revision,
    stagedTitle: null,
    stagedContent: null,
    expiresAt,
    createdAt: now,
  };

  const [lease] = await db
    .insert(noteLeases)
    .values(values)
    .onConflictDoUpdate({ target: noteLeases.noteId, set: values })
    .returning();

  return { lease, leaseToken: rawToken, baseRevision: draft.revision, expiresAt };
}

export async function heartbeatLease(
  db: Database,
  input: { noteId: string; leaseToken: string; ttlSeconds?: number; now?: Date },
): Promise<NoteLease> {
  const now = input.now ?? new Date();
  const ttl = input.ttlSeconds ?? LEASE_TTL_SECONDS;

  const [lease] = await db
    .select()
    .from(noteLeases)
    .where(
      and(
        eq(noteLeases.noteId, input.noteId),
        eq(noteLeases.tokenHash, hashToken(input.leaseToken)),
      ),
    )
    .limit(1);

  if (!lease || lease.expiresAt.getTime() <= now.getTime()) {
    throw new LeaseExpiredError();
  }

  const [updated] = await db
    .update(noteLeases)
    .set({ expiresAt: new Date(now.getTime() + ttl * 1_000) })
    .where(eq(noteLeases.noteId, input.noteId))
    .returning();

  return updated;
}

export interface CommitLeaseInput {
  noteId: string;
  leaseToken: string;
  mode: LeaseCommitMode;
  title?: string;
  content?: string;
  message?: string | null;
  now?: Date;
  moderator?: Moderator;
}

export interface CommitLeaseResult {
  revision: number;
  version: NoteVersion | null;
}

/**
 * Applies the staged (or supplied) content to the draft in one transaction,
 * releases the lease, and optionally creates a version. The base revision must
 * still match, so a human edit during the lease is a conflict, not a lost write.
 */
export async function commitLease(
  db: Database,
  input: CommitLeaseInput,
): Promise<CommitLeaseResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from notes where id = ${input.noteId} for update`);

    const [lease] = await tx
      .select()
      .from(noteLeases)
      .where(
        and(
          eq(noteLeases.noteId, input.noteId),
          eq(noteLeases.tokenHash, hashToken(input.leaseToken)),
        ),
      )
      .limit(1);

    if (!lease) {
      throw new LeaseExpiredError();
    }
    if (lease.expiresAt.getTime() <= now.getTime()) {
      await tx.delete(noteLeases).where(eq(noteLeases.noteId, input.noteId));
      throw new LeaseExpiredError();
    }

    const [draft] = await tx
      .select()
      .from(noteDrafts)
      .where(eq(noteDrafts.noteId, input.noteId))
      .limit(1);
    if (!draft) {
      throw new NotFoundError("Draft not found");
    }
    if (lease.baseRevision !== draft.revision) {
      throw new ConflictRevisionError(draft.revision);
    }

    const title =
      input.title === undefined ? (lease.stagedTitle ?? draft.title) : normalizeTitle(input.title);
    const content =
      input.content === undefined
        ? (lease.stagedContent ?? draft.content)
        : normalizeContent(input.content);
    assertContentSize(content);

    await runModeration(
      tx,
      { noteId: input.noteId, source: "commit", title, content },
      input.moderator,
    );

    const [updatedDraft] = await tx
      .update(noteDrafts)
      .set({
        title,
        content,
        revision: sql`${noteDrafts.revision} + 1`,
        updatedBy: lease.holderId,
        updatedAt: now,
      })
      .where(eq(noteDrafts.noteId, input.noteId))
      .returning();

    await tx.delete(noteLeases).where(eq(noteLeases.noteId, input.noteId));

    let version: NoteVersion | null = null;
    if (input.mode === "publish") {
      const [maxRow] = await tx
        .select({ max: sql<number>`coalesce(max(${noteVersions.versionNumber}), 0)` })
        .from(noteVersions)
        .where(eq(noteVersions.noteId, input.noteId));
      const versionNumber = Number(maxRow?.max ?? 0) + 1;

      [version] = await tx
        .insert(noteVersions)
        .values({
          noteId: input.noteId,
          versionNumber,
          title: updatedDraft.title,
          content: updatedDraft.content,
          message: input.message ?? null,
          authorId: lease.holderId,
          authorType: lease.holderType === "user" ? "human" : "ai",
          source: lease.clientId,
        })
        .returning();

      await tx
        .update(notes)
        .set({ publishedVersionId: version.id, updatedAt: now })
        .where(eq(notes.id, input.noteId));
    }

    return { revision: updatedDraft.revision, version };
  });
}

export async function abortLease(
  db: Database,
  input: { noteId: string; leaseToken: string },
): Promise<void> {
  await db
    .delete(noteLeases)
    .where(
      and(
        eq(noteLeases.noteId, input.noteId),
        eq(noteLeases.tokenHash, hashToken(input.leaseToken)),
      ),
    );
}

/** The owner can always force-release a lease (ADR-0004). */
export async function forceReleaseLease(
  db: Database,
  input: { noteId: string; ownerId: string },
): Promise<void> {
  await requireOwnedNote(db, input.noteId, input.ownerId);
  await db.delete(noteLeases).where(eq(noteLeases.noteId, input.noteId));
}
