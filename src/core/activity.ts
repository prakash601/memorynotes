import type { Database } from "@/db";
import { activityLog } from "@/db/schema";

export interface ActivityInput {
  actorUserId?: string | null;
  clientId?: string | null;
  platform?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Appends one audit row. Best-effort on purpose: a failed audit write must not
 * roll back the user's action, so callers do not await failures.
 */
export async function recordActivity(db: Database, input: ActivityInput): Promise<void> {
  try {
    await db.insert(activityLog).values({
      actorUserId: input.actorUserId ?? null,
      clientId: input.clientId ?? null,
      platform: input.platform ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    console.error("activity log write failed", error);
  }
}
