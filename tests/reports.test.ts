import { afterAll, beforeEach, expect, it } from "vitest";
import {
  GoneError,
  appealReport,
  createNote,
  createReport,
  listReports,
  publishNote,
  resolveShare,
  takedownReport,
  updateReportStatus,
  type Notification,
  type Notifier,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("reports and takedown", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function seedPublished() {
    const userId = await createTestUser(sql);
    const { note, rawToken } = await createNote(db, {
      ownerId: userId,
      title: "Reported",
      content: "# Body",
    });
    await publishNote(db, { noteId: note.id, userId });
    return { userId, note, rawToken };
  }

  it("creates a triage item from a share token with no account", async () => {
    const { rawToken } = await seedPublished();

    const report = await createReport(db, {
      shareToken: rawToken,
      reason: "spam",
      details: "looks like junk",
    });

    expect(report.status).toBe("open");
    expect(report.noteId).toBeTruthy();
    expect(report.reporterUserId).toBeNull();
  });

  it("rejects an unknown reason and an unknown token", async () => {
    const { rawToken } = await seedPublished();

    await expect(
      createReport(db, { shareToken: rawToken, reason: "not-a-reason" }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(createReport(db, { shareToken: "missing", reason: "spam" })).rejects.toMatchObject(
      { code: "not_found" },
    );
  });

  it("filters the queue by status", async () => {
    const { rawToken } = await seedPublished();
    const first = await createReport(db, { shareToken: rawToken, reason: "spam" });
    await createReport(db, { shareToken: rawToken, reason: "phishing" });
    await updateReportStatus(db, { reportId: first.id, status: "dismissed" });

    expect(await listReports(db, {})).toHaveLength(2);
    expect(await listReports(db, { status: "open" })).toHaveLength(1);
    expect(await listReports(db, { status: "dismissed" })).toHaveLength(1);
  });

  it("takedown hides the note, kills the link, and notifies the owner", async () => {
    const { userId, rawToken } = await seedPublished();
    const report = await createReport(db, { shareToken: rawToken, reason: "illegal" });

    const sent: Notification[] = [];
    const notifier: Notifier = {
      async send(notification) {
        sent.push(notification);
      },
    };

    const result = await takedownReport(db, { reportId: report.id, notifier });

    expect(result.report.status).toBe("actioned");
    expect(result.ownerId).toBe(userId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId, kind: "takedown" });

    await expect(resolveShare(db, rawToken)).rejects.toBeInstanceOf(GoneError);
  });

  it("lets only the owner appeal an actioned report", async () => {
    const { userId, rawToken } = await seedPublished();
    const report = await createReport(db, { shareToken: rawToken, reason: "spam" });
    const silent: Notifier = { async send() {} };
    await takedownReport(db, { reportId: report.id, notifier: silent });

    const otherUserId = await createTestUser(sql, "other");
    await expect(
      appealReport(db, { reportId: report.id, ownerId: otherUserId, message: "unfair" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const appealed = await appealReport(db, {
      reportId: report.id,
      ownerId: userId,
      message: "this was a mistake",
    });
    expect(appealed.status).toBe("reviewing");
    expect(appealed.resolutionNote).toContain("this was a mistake");
  });
});
