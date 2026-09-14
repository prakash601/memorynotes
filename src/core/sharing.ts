import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import {
  noteShares,
  noteVersions,
  notes,
  type Note,
  type NoteShare,
  type NoteVersion,
} from "@/db/schema";
import { SHARE_ACCESS_LEVELS, type ShareAccessLevel, type ShareExpiryOption } from "./constants";
import { GoneError, NotFoundError, ValidationError } from "./errors";
import { defaultExpiry, isExpired, resolveExpiry } from "./expiry";
import { requireOwnedNote } from "./notes";
import {
  decryptShareToken,
  encryptToken,
  generateShareToken,
  hashToken,
  primaryShareSecret,
  tokenPrefix,
} from "./tokens";

function assertAccess(value: string): asserts value is ShareAccessLevel {
  if (!(SHARE_ACCESS_LEVELS as readonly string[]).includes(value)) {
    throw new ValidationError(`Unknown share access: ${value}`);
  }
}

export async function getActiveShare(db: Database, noteId: string): Promise<NoteShare | null> {
  const [share] = await db
    .select()
    .from(noteShares)
    .where(and(eq(noteShares.noteId, noteId), isNull(noteShares.revokedAt)))
    .limit(1);
  return share ?? null;
}

export interface ShareView {
  access: ShareAccessLevel;
  expiresAt: Date | null;
  prefix: string;
  /** Null only when the stored ciphertext can no longer be decrypted. */
  rawToken: string | null;
}

export async function getShareView(
  db: Database,
  noteId: string,
  ownerId: string,
): Promise<ShareView | null> {
  await requireOwnedNote(db, noteId, ownerId);
  const share = await getActiveShare(db, noteId);
  if (!share) {
    return null;
  }
  return {
    access: share.access,
    expiresAt: share.expiresAt,
    prefix: share.tokenPrefix,
    rawToken: decryptShareToken(share.tokenCiphertext),
  };
}

export async function getOrCreateShare(
  db: Database,
  input: { noteId: string; ownerId: string; expiresIn?: ShareExpiryOption },
): Promise<{ share: NoteShare; rawToken: string }> {
  await requireOwnedNote(db, input.noteId, input.ownerId);

  const existing = await getActiveShare(db, input.noteId);
  if (existing) {
    const rawToken = decryptShareToken(existing.tokenCiphertext);
    if (rawToken) {
      return { share: existing, rawToken };
    }
  }

  const rawToken = generateShareToken();
  const expiresAt = input.expiresIn ? resolveExpiry(input.expiresIn) : defaultExpiry();

  const [share] = await db
    .insert(noteShares)
    .values({
      noteId: input.noteId,
      access: existing?.access ?? "view",
      tokenHash: hashToken(rawToken),
      tokenCiphertext: encryptToken(rawToken, primaryShareSecret()),
      tokenPrefix: tokenPrefix(rawToken),
      expiresAt,
      createdBy: input.ownerId,
    })
    .returning();

  return { share, rawToken };
}

export async function updateShare(
  db: Database,
  input: {
    noteId: string;
    ownerId: string;
    access?: string;
    expiresIn?: ShareExpiryOption;
    now?: Date;
  },
): Promise<NoteShare> {
  await requireOwnedNote(db, input.noteId, input.ownerId);
  if (input.access !== undefined) {
    assertAccess(input.access);
  }

  const existing = await getOrCreateShare(db, {
    noteId: input.noteId,
    ownerId: input.ownerId,
  });

  const now = input.now ?? new Date();
  const expiresAt = input.expiresIn === undefined ? undefined : resolveExpiry(input.expiresIn, now);

  const [updated] = await db
    .update(noteShares)
    .set({
      ...(input.access === undefined ? {} : { access: input.access }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    })
    .where(eq(noteShares.id, existing.share.id))
    .returning();

  return updated;
}

/**
 * Issues a fresh token and kills the old one. The old link stops working the
 * moment this commits, which is the point.
 */
export async function rotateShare(
  db: Database,
  input: { noteId: string; ownerId: string; now?: Date },
): Promise<{ share: NoteShare; rawToken: string }> {
  await requireOwnedNote(db, input.noteId, input.ownerId);
  const now = input.now ?? new Date();
  const previous = await getActiveShare(db, input.noteId);
  const rawToken = generateShareToken();

  return db.transaction(async (tx) => {
    if (previous) {
      await tx.update(noteShares).set({ revokedAt: now }).where(eq(noteShares.id, previous.id));
    }

    const stillValid =
      previous?.expiresAt && !isExpired(previous.expiresAt, now) ? previous.expiresAt : null;

    const [share] = await tx
      .insert(noteShares)
      .values({
        noteId: input.noteId,
        access: previous?.access ?? "view",
        tokenHash: hashToken(rawToken),
        tokenCiphertext: encryptToken(rawToken, primaryShareSecret()),
        tokenPrefix: tokenPrefix(rawToken),
        expiresAt: stillValid ?? defaultExpiry(now),
        createdBy: input.ownerId,
      })
      .returning();

    return { share, rawToken };
  });
}

export async function revokeShare(
  db: Database,
  input: { noteId: string; ownerId: string; now?: Date },
): Promise<void> {
  await requireOwnedNote(db, input.noteId, input.ownerId);
  const now = input.now ?? new Date();

  await db
    .update(noteShares)
    .set({ revokedAt: now })
    .where(and(eq(noteShares.noteId, input.noteId), isNull(noteShares.revokedAt)));
}

export interface ResolvedShare {
  share: NoteShare;
  note: Note;
  version: NoteVersion;
}

/**
 * Resolves a raw token to a readable note. Revoked links, expired links,
 * deleted notes, and notes that were never published all resolve to "gone".
 */
export async function resolveShare(
  db: Database,
  rawToken: string,
  now: Date = new Date(),
): Promise<ResolvedShare> {
  const [share] = await db
    .select()
    .from(noteShares)
    .where(eq(noteShares.tokenHash, hashToken(rawToken)))
    .limit(1);

  if (!share) {
    throw new NotFoundError("Link not found");
  }
  if (share.revokedAt || isExpired(share.expiresAt, now)) {
    throw new GoneError();
  }

  const [note] = await db.select().from(notes).where(eq(notes.id, share.noteId)).limit(1);
  if (!note || note.deletedAt || !note.publishedVersionId) {
    throw new GoneError();
  }

  const [version] = await db
    .select()
    .from(noteVersions)
    .where(eq(noteVersions.id, note.publishedVersionId))
    .limit(1);

  if (!version) {
    throw new GoneError();
  }

  return { share, note, version };
}
