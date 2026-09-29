import { z } from "zod";

/**
 * Runtime configuration. Validation is lazy on purpose: importing this module
 * must never throw, so `next build` can run without secrets present.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().min(1).default("http://localhost:3000"),
  SHARE_DOMAIN: z.string().min(1).default("localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  AUTH_GOOGLE_ID: z.string().min(1, "AUTH_GOOGLE_ID is required"),
  AUTH_GOOGLE_SECRET: z.string().min(1, "AUTH_GOOGLE_SECRET is required"),
  AUTH_GITHUB_ID: z.string().min(1, "AUTH_GITHUB_ID is required"),
  AUTH_GITHUB_SECRET: z.string().min(1, "AUTH_GITHUB_SECRET is required"),
  /** Optional. When unset, the purge endpoint stays disabled. */
  CRON_SECRET: z.string().min(1).optional(),
  /** Comma-separated emails allowed into the moderation triage queue. */
  ADMIN_EMAILS: z.string().optional(),
  /** Moderation provider name. The built-in local provider is the default. */
  MODERATION_PROVIDER: z.string().min(1).default("local"),
  /** Comma-separated sha256 hashes of known-materials content (CSAM gate). */
  MODERATION_BLOCKED_HASHES: z.string().optional(),
  /** Comma-separated substrings that always block (refused categories, A12). */
  MODERATION_BLOCKED_TERMS: z.string().optional(),
  /** Salt mixed into moderation hashes. Falls back to AUTH_SECRET when unset. */
  MODERATION_HASH_SALT: z.string().optional(),
  /**
   * Share-token encryption keys, newest first (S13). Optional; falls back to
   * AUTH_SECRET. Adding a key rotates without breaking existing links.
   */
  SHARE_TOKEN_SECRETS: z.string().optional(),
  /** Optional webhook that receives fired alerts as JSON. */
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  /** Support contact shown on the status page and in policies. */
  SUPPORT_EMAIL: z.string().email().optional(),
  /** Local-disk directory for uploaded note images. Defaults to ./uploads. */
  UPLOADS_DIR: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test helper: clears the memoized env so process.env changes are re-read. */
export function resetEnvCache(): void {
  cached = undefined;
}
