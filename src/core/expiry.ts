import {
  DEFAULT_SHARE_EXPIRY_DAYS,
  SHARE_EXPIRY_OPTIONS,
  type ShareExpiryOption,
} from "./constants";
import { ValidationError } from "./errors";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DURATIONS_MS: Record<Exclude<ShareExpiryOption, "never">, number> = {
  "1h": HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS,
};

export function isShareExpiryOption(value: unknown): value is ShareExpiryOption {
  return typeof value === "string" && (SHARE_EXPIRY_OPTIONS as readonly string[]).includes(value);
}

/** Resolves an expiry option to an absolute instant, or null for "never". */
export function resolveExpiry(option: ShareExpiryOption, now: Date = new Date()): Date | null {
  if (option === "never") {
    return null;
  }
  const duration = DURATIONS_MS[option];
  if (!duration) {
    throw new ValidationError(`Unknown expiry option: ${String(option)}`);
  }
  return new Date(now.getTime() + duration);
}

/** Default lifetime used when the caller does not specify one. */
export function defaultExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + DEFAULT_SHARE_EXPIRY_DAYS * DAY_MS);
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) {
    return false;
  }
  return expiresAt.getTime() <= now.getTime();
}
