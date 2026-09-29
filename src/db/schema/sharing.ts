import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { leaseHolderType, shareAccess } from "./enums";
import { notes } from "./notes";
import { users } from "./users";

/**
 * One canonical share link per note, enforced by a partial unique index.
 * Lookup is by hashing the presented token, so the raw value is never stored.
 */
export const noteShares = pgTable(
  "note_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    access: shareAccess("access").notNull().default("view"),
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    slug: text("slug"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    passwordHash: text("password_hash"),
    maxViews: integer("max_views"),
    viewsCount: integer("views_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("note_shares_token_hash_unique").on(t.tokenHash),
    uniqueIndex("note_shares_slug_unique")
      .on(t.slug)
      .where(sql`${t.slug} is not null`),
    uniqueIndex("note_shares_one_active_idx")
      .on(t.noteId)
      .where(sql`${t.revokedAt} is null`),
    index("note_shares_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.revokedAt} is null and ${t.expiresAt} is not null`),
  ],
);

/**
 * One exclusive write lease per note, enforced by the primary key. Always
 * time-bounded, so a crashed holder frees the note with no cleanup.
 */
export const noteLeases = pgTable(
  "note_leases",
  {
    noteId: uuid("note_id")
      .primaryKey()
      .references(() => notes.id, { onDelete: "cascade" }),
    holderId: uuid("holder_id").references(() => users.id, { onDelete: "set null" }),
    holderType: leaseHolderType("holder_type").notNull(),
    clientId: text("client_id"),
    tokenHash: text("token_hash").notNull(),
    baseRevision: integer("base_revision").notNull(),
    stagedTitle: text("staged_title"),
    stagedContent: text("staged_content"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("note_leases_expiry_idx").on(t.expiresAt)],
);

export type NoteShare = typeof noteShares.$inferSelect;
export type NoteLease = typeof noteLeases.$inferSelect;
