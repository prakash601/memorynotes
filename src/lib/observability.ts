import { getEnv } from "@/env";
import { logger } from "./logger";
import {
  MetricsRegistry,
  evaluateAlerts,
  renderPrometheus,
  type Alert,
  type MetricsSnapshot,
} from "./metrics";

const registry = new MetricsRegistry();

export function metrics(): MetricsRegistry {
  return registry;
}

export function metricsSnapshot(): MetricsSnapshot {
  return registry.snapshot();
}

export function renderMetrics(): string {
  return renderPrometheus(registry.snapshot());
}

export function recordRequest(route: string, status: number, durationMs: number): void {
  registry.recordRequest(route, status, durationMs);
}

/** Job outcomes feed the `job_failures` alert rule. */
export function recordJobResult(job: string, ok: boolean): void {
  logger.info("job.finished", { job, ok });
  if (!ok) {
    registry.increment("job_failures_total", { job });
  }
}

/**
 * Error tracking seam. Always logs; a real tracker (for example Sentry) hooks in
 * here without touching call sites.
 */
export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  registry.increment("errors_total", { type: String(context.type ?? "unhandled") });
  logger.error("unhandled_error", { ...context, error: message, stack });
}

export type AlertSink = (alerts: Alert[]) => Promise<void> | void;

async function webhookSink(alerts: Alert[], url: string): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alerts }),
    });
  } catch (error) {
    logger.error("alert.webhook_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Fires alerts to the log and, when configured, a webhook. */
export async function dispatchAlerts(alerts: Alert[]): Promise<void> {
  if (alerts.length === 0) {
    return;
  }
  for (const alert of alerts) {
    logger.warn("alert.fired", {
      rule: alert.rule,
      severity: alert.severity,
      summary: alert.summary,
    });
  }
  const { ALERT_WEBHOOK_URL } = getEnv();
  if (ALERT_WEBHOOK_URL) {
    await webhookSink(alerts, ALERT_WEBHOOK_URL);
  }
}

/** Evaluates the rules against the live snapshot and dispatches anything that fires. */
export async function evaluateAndDispatchAlerts(): Promise<Alert[]> {
  const alerts = evaluateAlerts(registry.snapshot());
  await dispatchAlerts(alerts);
  return alerts;
}

/**
 * Wraps a route handler so every request is counted and timed. Usage:
 * `export const POST = observed("notes.create", async (request) => { ... })`.
 */
export function observed<Context>(
  route: string,
  handler: (request: Request, context: Context) => Promise<Response>,
): (request: Request, context?: Context) => Promise<Response> {
  return async (request, context) => {
    const start = performance.now();
    try {
      const response = await handler(request, context as Context);
      recordRequest(route, response.status, performance.now() - start);
      return response;
    } catch (error) {
      recordRequest(route, 500, performance.now() - start);
      reportError(error, { route });
      throw error;
    }
  };
}
