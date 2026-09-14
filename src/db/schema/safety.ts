import { desc, sql } from "drizzle-orm";
import {
  bigserial,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { moderationResult, reportStatus } from "./enums";
import { notes } from "./notes";
import { noteShares } from "./sharing";
import { users } from "./users";

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    shareId: uuid("share_id").references(() => noteShares.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    details: text("details"),
    reporterUserId: uuid("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
    reporterIpHash: text("reporter_ip_hash"),
    status: reportStatus("status").notNull().default("open"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("reports_open_idx")
      .on(t.status, t.createdAt)
      .where(sql`${t.status} in ('open', 'reviewing')`),
  ],
);

export const moderationEvents = pgTable(
  "moderation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    result: moderationResult("result").notNull(),
    score: numeric("score", { precision: 5, scale: 4 }),
    provider: text("provider"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("moderation_events_note_idx").on(t.noteId, desc(t.createdAt))],
);

/** Audit trail for writes and platform attribution (ADR-0006). */
export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    clientId: text("client_id"),
    platform: text("platform"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_log_target_idx").on(t.targetType, t.targetId, desc(t.createdAt))],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ModerationEvent = typeof moderationEvents.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
