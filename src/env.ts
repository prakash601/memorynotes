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
