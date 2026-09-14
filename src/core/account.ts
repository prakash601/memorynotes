import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Database } from "@/db";
import {
  apiTokens,
  noteDrafts,
  noteShares,
  noteVersions,
  notes,
  oauthTokens,
  sessions,
  users,
} from "@/db/schema";
import { getEnv } from "@/env";
import { SOFT_DELETE_RETENTION_DAYS } from "./constants";
import { NotFoundError } from "./errors";
import { decryptShareToken } from "./tokens";

export interface AccountView {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date | null;
  status: string;
  createdAt: Date;
}

export async function getAccount(db: Database, userId: string): Promise<AccountView | null> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user ?? null;
}

export interface ExportedVersion {
  version_number: number;
  title: string;
  content: string;
  message: string | null;
  author_type: string;
  source: string | null;
  created_at: Date;
}

export interface ExportedNote {
  id: string;
  title: string;
  content: string;
  visibility: string;
  created_at: Date;
  updated_at: Date;
  share: { url: string | null; access: string; prefix: string; expires_at: Date | null } | null;
  versions: ExportedVersion[];
}

export interface AccountExport {
  generated_at: Date;
  account: AccountView;
  notes: ExportedNote[];
  /** A single-file markdown rendering of the same data (P5). */
  markdown: string;
}

function shareUrl(rawToken: string | null): string | null {
  if (!rawToken) {
    return null;
  }
  const domain = getEnv().SHARE_DOMAIN;
  const base = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
  return `${base.replace(/\/$/, "")}/n/${rawToken}`;
}

function renderMarkdown(account: AccountView, exported: ExportedNote[], now: Date): string {
  const lines: string[] = [
    `# ${account.name ?? account.email} - MemoryNotes export`,
    "",
    `Generated: ${now.toISOString()}`,
    `Account: ${account.email}`,
    `Notes: ${exported.length}`,
    "",
  ];

  for (const note of exported) {
    lines.push("---", "", `## ${note.title || "Untitled"}`, "");
    lines.push(
      `Visibility: ${note.visibility}` +
        (note.share?.url ? ` · Share: ${note.share.url}` : "") +
        ` · Updated: ${note.updated_at.toISOString()}`,
      "",
      note.content || "_(empty)_",
      "",
    );
    if (note.versions.length > 0) {
      lines.push("### Version history", "");
      for (const version of note.versions) {
        lines.push(
          `- v${version.version_number} (${version.created_at.toISOString()})` +
            (version.message ? `: ${version.message}` : ""),
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Self-serve export (P5): every note with its draft, its link, and its full
 * version history, as structured JSON plus a markdown rendering.
 */
export async function exportAccount(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<AccountExport> {
  const account = await getAccount(db, userId);
  if (!account) {
    throw new NotFoundError("Account not found");
  }

  const rows = await db
    .select({
      id: notes.id,
      visibility: notes.visibility,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      title: noteDrafts.title,
      content: noteDrafts.content,
    })
    .from(notes)
    .innerJoin(noteDrafts, eq(noteDrafts.noteId, notes.id))
    .where(and(eq(notes.ownerId, userId), isNull(notes.deletedAt)))
    .orderBy(notes.createdAt);

  const exported: ExportedNote[] = [];

  for (const row of rows) {
    const [share] = await db
      .select()
      .from(noteShares)
      .where(and(eq(noteShares.noteId, row.id), isNull(noteShares.revokedAt)))
      .limit(1);

    const versionRows = await db
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, row.id))
      .orderBy(noteVersions.versionNumber);

    exported.push({
      id: row.id,
      title: row.title,
      content: row.content,
      visibility: row.visibility,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      share: share
        ? {
            url: shareUrl(decryptShareToken(share.tokenCiphertext)),
            access: share.access,
            prefix: share.tokenPrefix,
            expires_at: share.expiresAt,
          }
        : null,
      versions: versionRows.map((version) => ({
        version_number: version.versionNumber,
        title: version.title,
        content: version.content,
        message: version.message,
        author_type: version.authorType,
        source: version.source,
        created_at: version.createdAt,
      })),
    });
  }

  return {
    generated_at: now,
    account,
    notes: exported,
    markdown: renderMarkdown(account, exported, now),
  };
}

/**
 * Self-serve delete (P5). Content and versions are purged immediately via the
 * cascade; the account row is tombstoned and purged after the retention window
 * so backups stay bounded (P11) and an accidental delete can still be reviewed.
 */
export async function deleteAccount(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<{ deletedAt: Date; purgedNotes: number }> {
  return db.transaction(async (tx) => {
    const removed = await tx.delete(notes).where(eq(notes.ownerId, userId)).returning({
      id: notes.id,
    });

    await tx
      .update(apiTokens)
      .set({ revokedAt: now })
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
    await tx
      .update(oauthTokens)
      .set({ revokedAt: now })
      .where(and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt)));
    await tx.delete(sessions).where(eq(sessions.userId, userId));

    const [updated] = await tx
      .update(users)
      .set({
        status: "deleted",
        deletedAt: now,
        updatedAt: now,
        // Free the address so the person can sign up again, and drop PII.
        email: `deleted-${userId}@deleted.invalid`,
        name: null,
        image: null,
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (!updated) {
      throw new NotFoundError("Account not found");
    }

    return { deletedAt: now, purgedNotes: removed.length };
  });
}

/** Hard-deletes tombstoned accounts past the retention window (doc 03). */
export async function purgeDeletedUsers(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
  const purged = await db
    .delete(users)
    .where(
      and(eq(users.status, "deleted"), isNotNull(users.deletedAt), lt(users.deletedAt, cutoff)),
    )
    .returning({ id: users.id });
  return purged.length;
}
