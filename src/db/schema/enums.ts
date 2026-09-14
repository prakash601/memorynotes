import { pgEnum } from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", ["active", "banned", "deleted"]);

/**
 * unlisted: anyone with the link can read, noindex (never called "private").
 * public: opted into search indexing.
 * private: login-gated, owner only.
 */
export const noteVisibility = pgEnum("note_visibility", ["unlisted", "public", "private"]);

export const shareAccess = pgEnum("share_access", ["view", "edit"]);

export const authorType = pgEnum("author_type", ["human", "ai"]);

export const leaseHolderType = pgEnum("lease_holder_type", ["user", "ai", "platform"]);

export const reportStatus = pgEnum("report_status", ["open", "reviewing", "actioned", "dismissed"]);

export const moderationResult = pgEnum("moderation_result", ["pass", "flag", "block"]);
