import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  noteDrafts,
  noteShares,
  noteVersions,
  notes,
  users,
  type Note,
  type NoteDraft,
  type NoteShare,
  type NoteVersion,
} from "@/db/schema";
import {
  NOTE_VISIBILITIES,
  SOFT_DELETE_RETENTION_DAYS,
  type NoteVisibility,
  type ShareAccessLevel,
  type ShareExpiryOption,
} from "./constants";
import {
  ConflictRevisionError,
  EmailNotVerifiedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { defaultExpiry, resolveExpiry } from "./expiry";
import { decodeCursor, encodeCursor, normalizeLimit } from "./cursor";
import { runModeration, type Moderator } from "./moderation";
import {
  decryptShareToken,
  encryptToken,
  generateShareToken,
  hashToken,
  primaryShareSecret,
  tokenPrefix,
} from "./tokens";
import { assertContentSize, normalizeContent, normalizeTitle } from "./validation";

function assertVisibility(value: string): asserts value is NoteVisibility {
  if (!(NOTE_VISIBILITIES as readonly string[]).includes(value)) {
    throw new ValidationError(`Unknown visibility: ${value}`);
  }
}

/** Loads a note the caller owns, or throws. Deleted notes are invisible. */
export async function requireOwnedNote(
  db: Database,
  noteId: string,
  ownerId: string,
): Promise<Note> {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.ownerId, ownerId), isNull(notes.deletedAt)))
    .limit(1);

  if (!note) {
    throw new NotFoundError("Note not found");
  }
  return note;
}

/**
 * Authorization for writes: the owner may always edit. A signed-in account may
 * edit when it presents a live, edit-capable share token (ADR-0002).
 */
export async function assertCanEdit(
  db: Database,
  input: { noteId: string; userId: string; shareToken?: string | null },
): Promise<Note> {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, input.noteId), isNull(notes.deletedAt)))
    .limit(1);

  if (!note) {
    throw new NotFoundError("Note not found");
  }
  if (note.ownerId === input.userId) {
    return note;
  }

  if (input.shareToken) {
    const [share] = await db
      .select()
      .from(noteShares)
      .where(
        and(
          eq(noteShares.noteId, note.id),
          eq(noteShares.tokenHash, hashToken(input.shareToken)),
          isNull(noteShares.revokedAt),
        ),
      )
      .limit(1);

    const expired = share?.expiresAt ? share.expiresAt.getTime() <= Date.now() : false;
    if (share && share.access === "edit" && !expired) {
      return note;
    }
  }

  throw new ForbiddenError("You do not have edit access to this note");
}

export interface CreateNoteInput {
  ownerId: string;
  title?: string;
  content?: string;
  visibility?: string;
  expiresIn?: ShareExpiryOption;
  now?: Date;
  /** Injectable moderator; defaults to the configured provider. */
  moderator?: Moderator;
}

/**
 * Creates the note, its draft, and its canonical share in one transaction, so
 * every note has a link from birth (doc 09).
 */
export async function createNote(db: Database, input: CreateNoteInput) {
  const now = input.now ?? new Date();
  const visibility = input.visibility ?? "unlisted";
  assertVisibility(visibility);

  const title = normalizeTitle(input.title);
  const content = normalizeContent(input.content);
  assertContentSize(content);

  // Moderation is a gate on every write path (doc 06). It runs before the
  // transaction so a slow vendor never holds a database transaction open.
  await runModeration(db, { source: "create", title, content }, input.moderator);

  const expiresAt = input.expiresIn ? resolveExpiry(input.expiresIn, now) : defaultExpiry(now);
  const rawToken = generateShareToken();

  return db.transaction(async (tx) => {
    const [note] = await tx
      .insert(notes)
      .values({ ownerId: input.ownerId, visibility })
      .returning();

    const [draft] = await tx
      .insert(noteDrafts)
      .values({
        noteId: note.id,
        title,
        content,
        revision: 1,
        updatedBy: input.ownerId,
      })
      .returning();

    const [share] = await tx
      .insert(noteShares)
      .values({
        noteId: note.id,
        access: "view",
        tokenHash: hashToken(rawToken),
        tokenCiphertext: encryptToken(rawToken, primaryShareSecret()),
        tokenPrefix: tokenPrefix(rawToken),
        expiresAt,
        createdBy: input.ownerId,
      })
      .returning();

    return { note, draft, share, rawToken };
  });
}

export interface OwnedNoteView {
  note: Note;
  draft: NoteDraft | null;
  share: NoteShare | null;
  publishedVersion: NoteVersion | null;
}

export async function getOwnedNote(
  db: Database,
  noteId: string,
  ownerId: string,
): Promise<OwnedNoteView> {
  return getNoteView(db, noteId, ownerId);
}

/**
 * Loads a note for anyone allowed to edit it: the owner, or a signed-in account
 * holding a live edit-capable link (ADR-0002).
 */
export async function getNoteView(
  db: Database,
  noteId: string,
  userId: string,
  shareToken?: string | null,
): Promise<OwnedNoteView> {
  const note = await assertCanEdit(db, { noteId, userId, shareToken });

  const [draft] = await db.select().from(noteDrafts).where(eq(noteDrafts.noteId, noteId)).limit(1);

  const [share] = await db
    .select()
    .from(noteShares)
    .where(and(eq(noteShares.noteId, noteId), isNull(noteShares.revokedAt)))
    .limit(1);

  let publishedVersion: NoteVersion | null = null;
  if (note.publishedVersionId) {
    const [version] = await db
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.id, note.publishedVersionId))
      .limit(1);
    publishedVersion = version ?? null;
  }

  return { note, draft: draft ?? null, share: share ?? null, publishedVersion };
}

export interface NoteListItem {
  id: string;
  title: string;
  visibility: NoteVisibility;
  revision: number;
  updatedAt: Date;
  publishedVersionNumber: number | null;
  share: {
    access: ShareAccessLevel;
    expiresAt: Date | null;
    prefix: string;
    rawToken: string | null;
  } | null;
}

interface NoteListRow {
  id: string;
  visibility: NoteVisibility;
  title: string;
  revision: number;
  updatedAt: Date;
  publishedVersionNumber: number | null;
  shareAccess: ShareAccessLevel | null;
  shareExpiresAt: Date | null;
  sharePrefix: string | null;
  shareCiphertext: string | null;
}

function mapNoteListRow(row: NoteListRow): NoteListItem {
  return {
    id: row.id,
    title: row.title,
    visibility: row.visibility,
    revision: row.revision,
    updatedAt: row.updatedAt,
    publishedVersionNumber: row.publishedVersionNumber ?? null,
    share:
      row.sharePrefix && row.shareAccess
        ? {
            access: row.shareAccess,
            expiresAt: row.shareExpiresAt,
            prefix: row.sharePrefix,
            rawToken: row.shareCiphertext ? decryptShareToken(row.shareCiphertext) : null,
          }
        : null,
  };
}

const NOTE_LIST_COLUMNS = {
  id: notes.id,
  visibility: notes.visibility,
  title: noteDrafts.title,
  revision: noteDrafts.revision,
  updatedAt: noteDrafts.updatedAt,
  publishedVersionNumber: noteVersions.versionNumber,
  shareAccess: noteShares.access,
  shareExpiresAt: noteShares.expiresAt,
  sharePrefix: noteShares.tokenPrefix,
  shareCiphertext: noteShares.tokenCiphertext,
};

export async function listNotes(db: Database, ownerId: string): Promise<NoteListItem[]> {
  const rows = await db
    .select(NOTE_LIST_COLUMNS)
    .from(notes)
    .innerJoin(noteDrafts, eq(noteDrafts.noteId, notes.id))
    .leftJoin(noteVersions, eq(noteVersions.id, notes.publishedVersionId))
    .leftJoin(noteShares, and(eq(noteShares.noteId, notes.id), isNull(noteShares.revokedAt)))
    .where(and(eq(notes.ownerId, ownerId), isNull(notes.deletedAt)))
    .orderBy(desc(noteDrafts.updatedAt));

  return rows.map(mapNoteListRow);
}

export interface NotesPage {
  data: NoteListItem[];
  nextCursor: string | null;
}

/** Keyset pagination on `(draft.updated_at, note.id)` desc (doc 09). */
export async function listNotesPage(
  db: Database,
  ownerId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<NotesPage> {
  const limit = normalizeLimit(options.limit);
  const cursor = options.cursor ? decodeCursor<{ u?: string; i?: string }>(options.cursor) : null;
  const cursorDate = cursor?.u ? new Date(cursor.u) : null;
  const cursorId = cursor?.i ?? null;
  const keyset =
    cursorDate && cursorId
      ? or(
          lt(noteDrafts.updatedAt, cursorDate),
          and(eq(noteDrafts.updatedAt, cursorDate), lt(notes.id, cursorId)),
        )
      : undefined;

  const rows = await db
    .select(NOTE_LIST_COLUMNS)
    .from(notes)
    .innerJoin(noteDrafts, eq(noteDrafts.noteId, notes.id))
    .leftJoin(noteVersions, eq(noteVersions.id, notes.publishedVersionId))
    .leftJoin(noteShares, and(eq(noteShares.noteId, notes.id), isNull(noteShares.revokedAt)))
    .where(and(eq(notes.ownerId, ownerId), isNull(notes.deletedAt), keyset))
    .orderBy(desc(noteDrafts.updatedAt), desc(notes.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map(mapNoteListRow);
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ u: last.updatedAt.toISOString(), i: last.id }) : null;

  return { data, nextCursor };
}

export interface UpdateDraftInput {
  noteId: string;
  userId: string;
  shareToken?: string | null;
  title?: string;
  content?: string;
  baseRevision: number;
  moderator?: Moderator;
}

/**
 * Optimistic concurrency: the write only lands if the draft is still on
 * baseRevision. Otherwise the caller gets a conflict with the current revision.
 */
export async function updateDraft(db: Database, input: UpdateDraftInput): Promise<NoteDraft> {
  await assertCanEdit(db, {
    noteId: input.noteId,
    userId: input.userId,
    shareToken: input.shareToken,
  });

  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 1) {
    throw new ValidationError("base_revision must be a positive integer");
  }

  const title = input.title === undefined ? undefined : normalizeTitle(input.title);
  const content = input.content === undefined ? undefined : normalizeContent(input.content);
  if (content !== undefined) {
    assertContentSize(content);
  }

  if (title !== undefined || content !== undefined) {
    await runModeration(
      db,
      { noteId: input.noteId, source: "patch", title, content },
      input.moderator,
    );
  }

  const [updated] = await db
    .update(noteDrafts)
    .set({
      ...(title === undefined ? {} : { title }),
      ...(content === undefined ? {} : { content }),
      revision: sql`${noteDrafts.revision} + 1`,
      updatedBy: input.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(noteDrafts.noteId, input.noteId), eq(noteDrafts.revision, input.baseRevision)))
    .returning();

  if (updated) {
    return updated;
  }

  const [current] = await db
    .select()
    .from(noteDrafts)
    .where(eq(noteDrafts.noteId, input.noteId))
    .limit(1);

  throw new ConflictRevisionError(current?.revision ?? input.baseRevision);
}

export interface PublishInput {
  noteId: string;
  userId: string;
  shareToken?: string | null;
  message?: string | null;
  baseRevision?: number;
  source?: string | null;
  moderator?: Moderator;
}

/**
 * Publishes the current draft as an immutable version. Rows are locked during
 * numbering so two concurrent publishes cannot collide.
 */
export async function publishNote(db: Database, input: PublishInput): Promise<NoteVersion> {
  await assertCanEdit(db, {
    noteId: input.noteId,
    userId: input.userId,
    shareToken: input.shareToken,
  });

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from notes where id = ${input.noteId} for update`);

    const [draft] = await tx
      .select()
      .from(noteDrafts)
      .where(eq(noteDrafts.noteId, input.noteId))
      .limit(1);

    if (!draft) {
      throw new NotFoundError("Draft not found");
    }
    if (input.baseRevision !== undefined && input.baseRevision !== draft.revision) {
      throw new ConflictRevisionError(draft.revision);
    }

    await runModeration(
      tx,
      { noteId: input.noteId, source: "commit", title: draft.title, content: draft.content },
      input.moderator,
    );

    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${noteVersions.versionNumber}), 0)` })
      .from(noteVersions)
      .where(eq(noteVersions.noteId, input.noteId));

    const versionNumber = Number(maxRow?.max ?? 0) + 1;

    const [version] = await tx
      .insert(noteVersions)
      .values({
        noteId: input.noteId,
        versionNumber,
        title: draft.title,
        content: draft.content,
        message: input.message ?? null,
        authorId: input.userId,
        authorType: "human",
        source: input.source ?? null,
      })
      .returning();

    await tx
      .update(notes)
      .set({ publishedVersionId: version.id, updatedAt: new Date() })
      .where(eq(notes.id, input.noteId));

    return version;
  });
}

export async function listVersions(
  db: Database,
  noteId: string,
  ownerId: string,
  shareToken?: string | null,
): Promise<NoteVersion[]> {
  await assertCanEdit(db, { noteId, userId: ownerId, shareToken });
  return db
    .select()
    .from(noteVersions)
    .where(eq(noteVersions.noteId, noteId))
    .orderBy(desc(noteVersions.versionNumber));
}

export interface VersionsPage {
  data: NoteVersion[];
  nextCursor: string | null;
}

/** Keyset pagination on `version_number` desc (doc 09). */
export async function listVersionsPage(
  db: Database,
  noteId: string,
  ownerId: string,
  options: { limit?: number; cursor?: string | null; shareToken?: string | null } = {},
): Promise<VersionsPage> {
  await assertCanEdit(db, { noteId, userId: ownerId, shareToken: options.shareToken });
  const limit = normalizeLimit(options.limit);
  const cursor = options.cursor ? decodeCursor<{ v?: number }>(options.cursor) : null;
  const keyset = cursor?.v !== undefined ? lt(noteVersions.versionNumber, cursor.v) : undefined;

  const rows = await db
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.noteId, noteId), keyset))
    .orderBy(desc(noteVersions.versionNumber))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ v: last.versionNumber }) : null;

  return { data, nextCursor };
}

export async function getVersion(
  db: Database,
  noteId: string,
  ownerId: string,
  versionNumber: number,
  shareToken?: string | null,
): Promise<NoteVersion> {
  await assertCanEdit(db, { noteId, userId: ownerId, shareToken });
  const [version] = await db
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.noteId, noteId), eq(noteVersions.versionNumber, versionNumber)))
    .limit(1);

  if (!version) {
    throw new NotFoundError("Version not found");
  }
  return version;
}

/**
 * Restores an earlier version by creating a NEW version from its content and
 * pointing the draft at it. History is never rewritten (ADR-0003).
 */
export async function restoreVersion(
  db: Database,
  input: { noteId: string; userId: string; versionNumber: number; shareToken?: string | null },
): Promise<{ version: NoteVersion; draft: NoteDraft }> {
  await assertCanEdit(db, {
    noteId: input.noteId,
    userId: input.userId,
    shareToken: input.shareToken,
  });
  const target = await getVersion(
    db,
    input.noteId,
    input.userId,
    input.versionNumber,
    input.shareToken,
  );

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from notes where id = ${input.noteId} for update`);

    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${noteVersions.versionNumber}), 0)` })
      .from(noteVersions)
      .where(eq(noteVersions.noteId, input.noteId));

    const versionNumber = Number(maxRow?.max ?? 0) + 1;

    const [version] = await tx
      .insert(noteVersions)
      .values({
        noteId: input.noteId,
        versionNumber,
        title: target.title,
        content: target.content,
        message: `Restored from version ${target.versionNumber}`,
        authorId: input.userId,
        authorType: "human",
      })
      .returning();

    const [draft] = await tx
      .update(noteDrafts)
      .set({
        title: target.title,
        content: target.content,
        revision: sql`${noteDrafts.revision} + 1`,
        updatedBy: input.userId,
        updatedAt: new Date(),
      })
      .where(eq(noteDrafts.noteId, input.noteId))
      .returning();

    await tx
      .update(notes)
      .set({ publishedVersionId: version.id, updatedAt: new Date() })
      .where(eq(notes.id, input.noteId));

    return { version, draft };
  });
}

export async function setVisibility(
  db: Database,
  input: { noteId: string; ownerId: string; visibility: string },
): Promise<Note> {
  assertVisibility(input.visibility);
  await requireOwnedNote(db, input.noteId, input.ownerId);

  // A5: a verified email is required before a note is opted into public
  // indexing. OAuth providers supply a verified email, so this only bites
  // accounts that signed up without one.
  if (input.visibility === "public") {
    const [owner] = await db
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, input.ownerId))
      .limit(1);
    if (!owner?.emailVerified) {
      throw new EmailNotVerifiedError();
    }
  }

  const [updated] = await db
    .update(notes)
    .set({ visibility: input.visibility, updatedAt: new Date() })
    .where(eq(notes.id, input.noteId))
    .returning();

  return updated;
}

/** Soft delete: the note hides immediately and purges after the window. */
export async function softDeleteNote(
  db: Database,
  input: { noteId: string; ownerId: string; now?: Date },
) {
  await requireOwnedNote(db, input.noteId, input.ownerId);
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [note] = await tx
      .update(notes)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(notes.id, input.noteId))
      .returning();

    // The link dies immediately, even though the content is retained.
    await tx
      .update(noteShares)
      .set({ revokedAt: now })
      .where(and(eq(noteShares.noteId, input.noteId), isNull(noteShares.revokedAt)));

    return note;
  });
}

/**
 * Purges notes soft-deleted longer than the retention window. Cascades remove
 * drafts, versions, and shares. Reports survive with a null note reference.
 */
export async function purgeDeletedNotes(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const purged = await db
    .delete(notes)
    // Drizzle's typed operators carry the column's type mapping; a raw sql
    // template would hand postgres.js an untyped Date and fail.
    .where(and(isNotNull(notes.deletedAt), lt(notes.deletedAt, cutoff)))
    .returning({ id: notes.id });

  return purged.length;
}
