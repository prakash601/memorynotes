import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { noteShares, notes, reports, type Report } from "@/db/schema";
import { REPORT_REASONS, type ReportReason } from "./constants";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { getDefaultNotifier, type Notifier } from "./notifications";
import { hashToken } from "./tokens";

const REPORT_STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

function assertReason(value: string): asserts value is ReportReason {
  if (!(REPORT_REASONS as readonly string[]).includes(value)) {
    throw new ValidationError(`Unknown report reason: ${value}`);
  }
}

function assertStatus(value: string): asserts value is ReportStatus {
  if (!(REPORT_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError(`Unknown report status: ${value}`);
  }
}

export interface CreateReportInput {
  reason: string;
  details?: string | null;
  /** Public reports are keyed by the share token the reporter is looking at. */
  shareToken?: string | null;
  noteId?: string | null;
  reporterUserId?: string | null;
  reporterIpHash?: string | null;
  now?: Date;
}

/**
 * Creates a triage item. The reporter is either anonymous (read page) or a
 * signed-in account; the IP is only ever stored as a hash (P3).
 */
export async function createReport(db: Database, input: CreateReportInput): Promise<Report> {
  assertReason(input.reason);

  let noteId = input.noteId ?? null;
  let shareId: string | null = null;

  if (input.shareToken) {
    const [share] = await db
      .select()
      .from(noteShares)
      .where(eq(noteShares.tokenHash, hashToken(input.shareToken)))
      .limit(1);
    if (!share) {
      throw new NotFoundError("Link not found");
    }
    noteId = share.noteId;
    shareId = share.id;
  } else if (noteId) {
    const [note] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.id, noteId))
      .limit(1);
    if (!note) {
      throw new NotFoundError("Note not found");
    }
  } else {
    throw new ValidationError("A report needs a share token or a note id");
  }

  const [report] = await db
    .insert(reports)
    .values({
      noteId,
      shareId,
      reason: input.reason,
      details: input.details ?? null,
      reporterUserId: input.reporterUserId ?? null,
      reporterIpHash: input.reporterIpHash ?? null,
      status: "open",
      createdAt: input.now ?? new Date(),
    })
    .returning();

  return report;
}

export async function getReport(db: Database, reportId: string): Promise<Report> {
  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report) {
    throw new NotFoundError("Report not found");
  }
  return report;
}

export interface ListReportsInput {
  status?: string;
  limit?: number;
}

export async function listReports(db: Database, input: ListReportsInput = {}): Promise<Report[]> {
  if (input.status !== undefined) {
    assertStatus(input.status);
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

  return db
    .select()
    .from(reports)
    .where(input.status ? eq(reports.status, input.status) : undefined)
    .orderBy(asc(reports.createdAt))
    .limit(limit);
}

export interface ResolveReportInput {
  reportId: string;
  status: string;
  resolutionNote?: string | null;
  now?: Date;
}

export async function updateReportStatus(db: Database, input: ResolveReportInput): Promise<Report> {
  assertStatus(input.status);

  const [updated] = await db
    .update(reports)
    .set({
      status: input.status,
      resolutionNote: input.resolutionNote ?? null,
      updatedAt: input.now ?? new Date(),
    })
    .where(eq(reports.id, input.reportId))
    .returning();

  if (!updated) {
    throw new NotFoundError("Report not found");
  }
  return updated;
}

export interface TakedownInput {
  reportId: string;
  moderatorId?: string | null;
  resolutionNote?: string | null;
  notifier?: Notifier;
  now?: Date;
}

/**
 * Takedown (A8): hides the note and its link immediately, marks the report
 * actioned, and notifies the owner. The note stays recoverable through the
 * 30-day soft-delete window, so an appeal has something to review.
 */
export async function takedownReport(
  db: Database,
  input: TakedownInput,
): Promise<{ report: Report; noteId: string | null; ownerId: string | null }> {
  const report = await getReport(db, input.reportId);
  const now = input.now ?? new Date();
  const notifier = input.notifier ?? getDefaultNotifier();

  let ownerId: string | null = null;
  if (report.noteId) {
    const [note] = await db
      .select({ ownerId: notes.ownerId })
      .from(notes)
      .where(eq(notes.id, report.noteId))
      .limit(1);
    ownerId = note?.ownerId ?? null;

    await db.transaction(async (tx) => {
      await tx
        .update(notes)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(notes.id, report.noteId as string));
      await tx
        .update(noteShares)
        .set({ revokedAt: now })
        .where(and(eq(noteShares.noteId, report.noteId as string), isNull(noteShares.revokedAt)));
    });
  }

  const updated = await updateReportStatus(db, {
    reportId: input.reportId,
    status: "actioned",
    resolutionNote: input.resolutionNote ?? "Content removed after review",
    now,
  });

  if (ownerId) {
    await notifier.send({
      userId: ownerId,
      kind: "takedown",
      subject: "A note was removed after review",
      body: "One of your notes was removed following a report. You can appeal this decision.",
      metadata: {
        reportId: report.id,
        noteId: report.noteId,
        moderatorId: input.moderatorId ?? null,
      },
    });
  }

  return { report: updated, noteId: report.noteId, ownerId };
}

export interface AppealInput {
  reportId: string;
  ownerId: string;
  message: string;
  now?: Date;
}

/**
 * Appeal path (A8). Only the owner of the reported note may appeal; the report
 * moves back to `reviewing` so a human looks again.
 */
export async function appealReport(db: Database, input: AppealInput): Promise<Report> {
  const report = await getReport(db, input.reportId);
  if (!report.noteId) {
    throw new NotFoundError("The note tied to this report no longer exists");
  }

  const [note] = await db
    .select({ ownerId: notes.ownerId })
    .from(notes)
    .where(eq(notes.id, report.noteId))
    .limit(1);

  if (!note || note.ownerId !== input.ownerId) {
    throw new ForbiddenError("Only the owner can appeal this decision");
  }
  if (report.status !== "actioned") {
    throw new ValidationError("Only an actioned report can be appealed");
  }

  return updateReportStatus(db, {
    reportId: input.reportId,
    status: "reviewing",
    resolutionNote: `Appeal: ${input.message}`.slice(0, 2_000),
    now: input.now ?? new Date(),
  });
}
