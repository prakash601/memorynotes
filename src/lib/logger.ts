import { randomUUID } from "node:crypto";

/**
 * Structured JSON logging (NFR-5). One line per event so the host can index it,
 * with secrets and credentials redacted. No external dependency.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "token_hash",
  "tokenhash",
  "secret",
  "password",
  "api_key",
  "apikey",
  "idempotency-key",
  "client_secret",
  "refresh_token",
]);

const MAX_DEPTH = 4;

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

function levelEnabled(level: LogLevel): boolean {
  const configured = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
  return LEVEL_ORDER[level] >= (LEVEL_ORDER[configured] ?? LEVEL_ORDER.info);
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  function write(level: LogLevel, message: string, fields?: Record<string, unknown>) {
    if (!levelEnabled(level)) {
      return;
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...(redact(bindings) as Record<string, unknown>),
      ...((fields ? redact(fields) : {}) as Record<string, unknown>),
    });
    process.stdout.write(`${line}\n`);
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger({ service: "memorynotes" });

export function newRequestId(): string {
  return randomUUID();
}

/** Stable fields for a request log line. Never logs the body or headers. */
export function requestFields(request: Request): Record<string, unknown> {
  const url = new URL(request.url);
  return {
    method: request.method,
    path: url.pathname,
    request_id: request.headers.get("x-request-id") ?? newRequestId(),
  };
}
