import { createHash } from "node:crypto";
import type { Database } from "@/db";
import { moderationEvents } from "@/db/schema";
import { getEnv } from "@/env";
import { MODERATION_SOURCES, type ModerationSource } from "./constants";
import { ModerationBlockedError, ValidationError } from "./errors";

export type ModerationResult = "pass" | "flag" | "block";

export interface ModerationDecision {
  result: ModerationResult;
  score: number | null;
  provider: string;
  categories: string[];
  detail?: unknown;
}

export interface ModerationRequest {
  source: ModerationSource;
  title?: string;
  content?: string;
}

/**
 * The seam a real vendor implements. The domain only depends on this interface,
 * so create, patch, and commit never call a network directly (doc 06, A4).
 */
export interface Moderator {
  check(request: ModerationRequest): Promise<ModerationDecision>;
}

function assertSource(value: string): asserts value is ModerationSource {
  if (!(MODERATION_SOURCES as readonly string[]).includes(value)) {
    throw new ValidationError(`Unknown moderation source: ${value}`);
  }
}

/**
 * Collapses whitespace and lowercases so trivial reformatting cannot evade a
 * hash match. Real known-materials hashes are computed over the same
 * normalization by the moderation vendor.
 */
export function normalizeForHash(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function contentHash(content: string, salt = ""): string {
  return createHash("sha256")
    .update(`${salt}:${normalizeForHash(content)}`)
    .digest("hex");
}

export interface LocalModeratorConfig {
  blockedHashes?: string[];
  blockedTerms?: string[];
  hashSalt?: string;
  provider?: string;
}

/**
 * The built-in provider: exact hash matching against a known-materials list plus
 * configurable blocked terms. It is the CSAM hash gate and the abuse baseline
 * until a vendor is selected.
 */
export function createLocalModerator(config: LocalModeratorConfig = {}): Moderator {
  const provider = config.provider ?? "local";
  const blocked = new Set(
    (config.blockedHashes ?? []).map((hash) => hash.trim().toLowerCase()).filter(Boolean),
  );
  const terms = (config.blockedTerms ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  return {
    async check(request) {
      const combined = `${request.title ?? ""}\n${request.content ?? ""}`;
      const categories: string[] = [];

      // The CSAM / known-materials gate: a hash match blocks unconditionally.
      const bodyHash = contentHash(request.content ?? "", config.hashSalt);
      const titleHash = contentHash(request.title ?? "", config.hashSalt);
      if (blocked.has(bodyHash) || blocked.has(titleHash)) {
        categories.push("hash_match");
      }

      const lowered = combined.toLowerCase();
      const matchedTerm = terms.find((term) => lowered.includes(term));
      if (matchedTerm) {
        categories.push("blocked_term");
      }

      if (categories.length > 0) {
        return { result: "block", score: 1, provider, categories, detail: { matchedTerm } };
      }
      return { result: "pass", score: 0, provider, categories: [] };
    },
  };
}

/** Deterministic moderator for tests and for a future vendor adapter. */
export function createFixedModerator(decision: Partial<ModerationDecision> = {}): Moderator {
  const resolved: ModerationDecision = {
    result: decision.result ?? "pass",
    score: decision.score ?? null,
    provider: decision.provider ?? "test",
    categories: decision.categories ?? [],
    detail: decision.detail,
  };
  return {
    async check() {
      return resolved;
    },
  };
}

export function getDefaultModerator(): Moderator {
  const env = getEnv();
  return createLocalModerator({
    blockedHashes: env.MODERATION_BLOCKED_HASHES?.split(",") ?? [],
    blockedTerms: env.MODERATION_BLOCKED_TERMS?.split(",") ?? [],
    hashSalt: env.MODERATION_HASH_SALT,
    provider: env.MODERATION_PROVIDER,
  });
}

export interface ModerationRunInput {
  noteId?: string | null;
  source: ModerationSource;
  title?: string;
  content?: string;
}

/** Only needs `insert`; accepts both the database and a transaction. */
type ModerationDatabase = Pick<Database, "insert">;

/**
 * Runs the moderator, records the event, and throws when content is blocked.
 * Flagged content is recorded but allowed through for human review.
 */
export async function runModeration(
  db: ModerationDatabase,
  input: ModerationRunInput,
  moderator: Moderator = getDefaultModerator(),
): Promise<ModerationDecision> {
  assertSource(input.source);
  const decision = await moderator.check({
    source: input.source,
    title: input.title,
    content: input.content,
  });

  await db.insert(moderationEvents).values({
    noteId: input.noteId ?? null,
    source: input.source,
    result: decision.result,
    score: decision.score === null ? null : decision.score.toFixed(4),
    provider: decision.provider,
    detail: { categories: decision.categories, ...(decision.detail ?? {}) },
  });

  if (decision.result === "block") {
    throw new ModerationBlockedError(decision.categories);
  }
  return decision;
}
