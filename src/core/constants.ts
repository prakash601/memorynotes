/** 1 MiB of text, per doc 01. */
export const MAX_CONTENT_BYTES = 1_048_576;

/** Default share-link lifetime, per doc 05. */
export const DEFAULT_SHARE_EXPIRY_DAYS = 30;

export const SHARE_EXPIRY_OPTIONS = ["1h", "24h", "7d", "30d", "90d", "never"] as const;
export type ShareExpiryOption = (typeof SHARE_EXPIRY_OPTIONS)[number];

/** Lease TTL and heartbeat cadence, per ADR-0004. */
export const LEASE_TTL_SECONDS = 60;
export const LEASE_HEARTBEAT_SECONDS = 15;

/** Soft-delete window before content and versions are purged (ADR-0003). */
export const SOFT_DELETE_RETENTION_DAYS = 30;

export const NOTE_VISIBILITIES = ["unlisted", "public", "private"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const SHARE_ACCESS_LEVELS = ["view", "edit"] as const;
export type ShareAccessLevel = (typeof SHARE_ACCESS_LEVELS)[number];

/** The three write paths moderation must cover (doc 06). */
export const MODERATION_SOURCES = ["create", "patch", "commit", "hash_match"] as const;
export type ModerationSource = (typeof MODERATION_SOURCES)[number];

/** Reasons a viewer can report a note with (doc 06). */
export const REPORT_REASONS = [
  "spam",
  "phishing",
  "illegal",
  "harassment",
  "doxxing",
  "malware",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Published triage SLA, best effort (doc 06, A7). */
export const REPORT_SLA_HOURS = { acknowledge: 24, resolve: 48 } as const;
