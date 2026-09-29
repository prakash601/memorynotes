import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
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
import { GoneError, NotFoundError, UnauthorizedError, ValidationError } from "./errors";
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
  passwordProtected: boolean;
  maxViews: number | null;
  viewsCount: number;
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
    passwordProtected: share.passwordHash !== null,
    maxViews: share.maxViews,
    viewsCount: share.viewsCount,
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
export interface ResolveShareOptions {
  /**
   * Presented link password. Required when the share is password-protected;
   * ignored otherwise. Checked before the view is counted, so a wrong guess
   * never burns a view-once link.
   */
  password?: string | null;
  /**
   * Whether a successful read consumes one view of a limited link.
   * The owner's own views are exempt (ADR-0002): they never go through the
   * public path, and the read page opts out explicitly for signed-in owners.
   */
  countView?: boolean;
  /**
   * When set to the note owner's id, view counting is skipped for that owner.
   * In-app views (dashboard, editor) never count; this covers an owner opening
   * their own public link while signed in.
   */
  exemptOwnerId?: string | null;
}

export async function resolveShare(
  db: Database,
  rawToken: string,
  now: Date = new Date(),
  options: ResolveShareOptions = {},
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

  if (share.passwordHash) {
    if (!options.password) {
      throw new UnauthorizedError("This link requires a password");
    }
    if (!(await verifySharePassword(options.password, share.passwordHash))) {
      throw new UnauthorizedError("Incorrect password");
    }
  }

  const ownerExempt =
    options.countView === false ||
    (options.exemptOwnerId != null && note.ownerId === options.exemptOwnerId);
  if (!ownerExempt && share.maxViews !== null) {
    // Atomic burn: exactly maxViews reads succeed, even under concurrency.
    // The first read of a view-once link (maxViews 1) succeeds here and every
    // later read finds views_count >= maxViews and resolves to gone.
    const [consumed] = await db
      .update(noteShares)
      .set({ viewsCount: sql`${noteShares.viewsCount} + 1` })
      .where(and(eq(noteShares.id, share.id), sql`${noteShares.viewsCount} < ${share.maxViews}`))
      .returning({ viewsCount: noteShares.viewsCount });
    if (!consumed) {
      throw new GoneError();
    }
    share.viewsCount = consumed.viewsCount;
  }

  return { share, note, version };
}

function scryptKey(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, opts, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key as Buffer);
    });
  });
}

/** scrypt parameters: interactive-work-factor, OWASP-conscious for short link passwords. */
const PASSWORD_SCRYPT_N = 16384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;

/** Link passwords are user-chosen; cap length, require non-empty. */
export const MAX_SHARE_PASSWORD_LENGTH = 256;

/**
 * Hashes a link password with a random salt (node scrypt, no new dependency).
 * Stored as `scrypt$N$r$p$saltB64$keyB64` so parameters travel with the hash.
 */
export async function hashSharePassword(password: string): Promise<string> {
  if (!password || password.length > MAX_SHARE_PASSWORD_LENGTH) {
    throw new ValidationError("Password must be 1-256 characters");
  }
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const key = await scryptKey(password, salt, PASSWORD_KEY_BYTES, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
  });
  return [
    "scrypt",
    String(PASSWORD_SCRYPT_N),
    String(PASSWORD_SCRYPT_R),
    String(PASSWORD_SCRYPT_P),
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/** Constant-time password check. Unknown or malformed hashes never match. */
export async function verifySharePassword(password: string, hash: string): Promise<boolean> {
  try {
    const [algo, n, r, p, saltB64, keyB64] = hash.split("$");
    if (algo !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) {
      return false;
    }
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(keyB64, "base64");
    if (salt.length === 0 || expected.length === 0) {
      return false;
    }
    const actual = await scryptKey(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Sets (or with null, removes) the link password. The raw password is never
 * stored; only the scrypt hash. Setting a password does not rotate the token.
 */
export async function setSharePassword(
  db: Database,
  input: { noteId: string; ownerId: string; password: string | null },
): Promise<NoteShare> {
  const { share } = await getOrCreateShare(db, { noteId: input.noteId, ownerId: input.ownerId });
  const passwordHash = input.password === null ? null : await hashSharePassword(input.password);
  const [updated] = await db
    .update(noteShares)
    .set({ passwordHash })
    .where(eq(noteShares.id, share.id))
    .returning();
  return updated;
}

/**
 * Sets (or with null, removes) the view limit. maxViews 1 is a view-once
 * link: the first successful read burns it. Counts start at zero when set.
 */
export async function setShareMaxViews(
  db: Database,
  input: { noteId: string; ownerId: string; maxViews: number | null },
): Promise<NoteShare> {
  if (
    input.maxViews !== null &&
    (!Number.isInteger(input.maxViews) || (input.maxViews as number) < 1)
  ) {
    throw new ValidationError("max_views must be a positive integer or null");
  }
  const { share } = await getOrCreateShare(db, { noteId: input.noteId, ownerId: input.ownerId });
  const [updated] = await db
    .update(noteShares)
    .set({ maxViews: input.maxViews, viewsCount: 0 })
    .where(eq(noteShares.id, share.id))
    .returning();
  return updated;
}
