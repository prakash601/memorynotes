import { desc, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authorType, noteVisibility } from "./enums";
import { users } from "./users";

/**
 * Identity, ownership, visibility, and lifecycle. Title and body live on the
 * draft and on each version, never on this row.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    visibility: noteVisibility("visibility").notNull().default("unlisted"),
    // Circular reference (notes <-> note_versions), so the target is explicitly
    // typed. This is the documented Drizzle workaround.
    publishedVersionId: uuid("published_version_id").references(
      (): AnyPgColumn => noteVersions.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    isFavorite: boolean("is_favorite").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
  },
  (t) => [
    index("notes_owner_idx")
      .on(t.ownerId)
      .where(sql`${t.deletedAt} is null`),
    index("notes_purge_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/** The autosaved working copy. Exactly one row per note, never lost. */
export const noteDrafts = pgTable("note_drafts", {
  noteId: uuid("note_id")
    .primaryKey()
    .references(() => notes.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Immutable snapshots created by an explicit publish. Never updated. */
export const noteVersions = pgTable(
  "note_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull(),
    message: text("message"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    authorType: authorType("author_type").notNull().default("human"),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("note_versions_number_unique").on(t.noteId, t.versionNumber),
    index("note_versions_note_idx").on(t.noteId, desc(t.versionNumber)),
  ],
);

/** Per-note tags. Tag text is normalized (lowercase, trimmed) in core. */
export const noteTags = pgTable(
  "note_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("note_tags_note_tag_unique").on(t.noteId, t.tag),
    index("note_tags_tag_idx").on(t.tag),
    index("note_tags_note_idx").on(t.noteId),
  ],
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type NoteTag = typeof noteTags.$inferSelect;
export type NoteDraft = typeof noteDrafts.$inferSelect;
export type NoteVersion = typeof noteVersions.$inferSelect;
