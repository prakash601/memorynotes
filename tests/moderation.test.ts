import { afterAll, beforeEach, expect, it } from "vitest";
import {
  ModerationBlockedError,
  contentHash,
  createFixedModerator,
  createLocalModerator,
  createNote,
  runModeration,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

it("normalizes whitespace so a hash match cannot be evaded by reformatting", () => {
  expect(contentHash("Hello   World")).toBe(contentHash("hello world"));
  expect(contentHash("Hello world")).not.toBe(contentHash("hello worlds"));
});

it("blocks a known-materials hash (the CSAM gate)", async () => {
  const body = "known material";
  const moderator = createLocalModerator({ blockedHashes: [contentHash(body)] });

  const decision = await moderator.check({ source: "create", content: body });
  expect(decision.result).toBe("block");
  expect(decision.categories).toContain("hash_match");
});

it("blocks refused-category terms", async () => {
  const moderator = createLocalModerator({ blockedTerms: ["buy cheap pills"] });
  const decision = await moderator.check({ source: "patch", content: "BUY CHEAP PILLS now" });

  expect(decision.result).toBe("block");
  expect(decision.categories).toContain("blocked_term");
});

it("passes clean content", async () => {
  const moderator = createLocalModerator({ blockedTerms: ["forbidden"] });
  const decision = await moderator.check({ source: "commit", content: "A normal note." });
  expect(decision.result).toBe("pass");
  expect(decision.categories).toEqual([]);
});

describeWithDatabase("moderation service", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  it("records an event and throws when content is blocked", async () => {
    await expect(
      runModeration(
        db,
        { source: "create", content: "blocked" },
        createFixedModerator({ result: "block", categories: ["hash_match"] }),
      ),
    ).rejects.toBeInstanceOf(ModerationBlockedError);

    const [row] = await sql<{ result: string; source: string }[]>`
      select result, source from moderation_events limit 1
    `;
    expect(row).toEqual({ result: "block", source: "create" });
  });

  it("records the moderation event for an allowed write", async () => {
    const userId = await createTestUser(sql);
    const { note } = await createNote(db, { ownerId: userId, content: "clean" });

    await runModeration(
      db,
      { noteId: note.id, source: "commit", content: "clean" },
      createFixedModerator({ result: "pass" }),
    );

    const [row] = await sql<{ note_id: string; result: string }[]>`
      select note_id, result from moderation_events order by created_at desc limit 1
    `;
    expect(row.note_id).toBe(note.id);
    expect(row.result).toBe("pass");
  });
});
