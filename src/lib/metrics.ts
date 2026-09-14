/**
 * A tiny in-process metrics registry (NFR-5). It is deliberately dependency
 * free and externalizable: production can export the same snapshot to a real
 * backend. Histograms keep raw samples, which is fine at v1 traffic and keeps
 * percentiles exact for the alert rules.
 */
export type Labels = Record<string, string>;

export interface RequestCount {
  route: string;
  statusClass: string;
  count: number;
}

export interface LatencySeries {
  route: string;
  values: number[];
}

export interface CounterSeries {
  name: string;
  labels: Labels;
  value: number;
}

export interface MetricsSnapshot {
  requests: RequestCount[];
  latency: LatencySeries[];
  counters: CounterSeries[];
}

const MAX_SAMPLES_PER_SERIES = 5_000;

function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

function labelKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

export class MetricsRegistry {
  private requests = new Map<string, RequestCount>();
  private latency = new Map<string, number[]>();
  private counters = new Map<string, CounterSeries>();

  recordRequest(route: string, status: number, durationMs: number): void {
    const classKey = `${route}|${statusClass(status)}`;
    const existing = this.requests.get(classKey);
    if (existing) {
      existing.count += 1;
    } else {
      this.requests.set(classKey, { route, statusClass: statusClass(status), count: 1 });
    }

    const samples = this.latency.get(route) ?? [];
    samples.push(durationMs);
    if (samples.length > MAX_SAMPLES_PER_SERIES) {
      samples.splice(0, samples.length - MAX_SAMPLES_PER_SERIES);
    }
    this.latency.set(route, samples);
  }

  increment(name: string, labels: Labels = {}, by = 1): void {
    const key = `${name}|${labelKey(labels)}`;
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += by;
    } else {
      this.counters.set(key, { name, labels, value: by });
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      requests: [...this.requests.values()].map((row) => ({ ...row })),
      latency: [...this.latency.entries()].map(([route, values]) => ({
        route,
        values: [...values],
      })),
      counters: [...this.counters.values()].map((row) => ({ ...row, labels: { ...row.labels } })),
    };
  }

  reset(): void {
    this.requests.clear();
    this.latency.clear();
    this.counters.clear();
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export interface Alert {
  rule: "error_rate" | "latency" | "job_failures";
  severity: "warning" | "critical";
  summary: string;
  value: number;
}

export interface AlertThresholds {
  /** Ignore error-rate alerts until this many requests are sampled. */
  minRequests: number;
  errorRate: number;
  minLatencySamples: number;
  latencyP95Ms: number;
  /** A job-failure counter at or above this fires. */
  jobFailureThreshold: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  minRequests: 20,
  errorRate: 0.05,
  minLatencySamples: 20,
  latencyP95Ms: 500,
  jobFailureThreshold: 1,
};

/**
 * Pure alert evaluation over a snapshot, so it can be tested without a live
 * process and scheduled from anywhere.
 */
export function evaluateAlerts(
  snapshot: MetricsSnapshot,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): Alert[] {
  const alerts: Alert[] = [];

  const total = snapshot.requests.reduce((sum, row) => sum + row.count, 0);
  const errors = snapshot.requests
    .filter((row) => row.statusClass === "5xx")
    .reduce((sum, row) => sum + row.count, 0);
  const errorRate = total === 0 ? 0 : errors / total;
  if (total >= thresholds.minRequests && errorRate > thresholds.errorRate) {
    alerts.push({
      rule: "error_rate",
      severity: "critical",
      summary: `5xx rate ${(errorRate * 100).toFixed(1)}% over ${total} requests`,
      value: errorRate,
    });
  }

  const latencies = snapshot.latency.flatMap((series) => series.values);
  const p95 = percentile(latencies, 95);
  if (latencies.length >= thresholds.minLatencySamples && p95 > thresholds.latencyP95Ms) {
    alerts.push({
      rule: "latency",
      severity: "warning",
      summary: `p95 latency ${p95.toFixed(0)}ms over ${latencies.length} samples`,
      value: p95,
    });
  }

  const jobFailures = snapshot.counters
    .filter((row) => row.name === "job_failures_total")
    .reduce((sum, row) => sum + row.value, 0);
  if (jobFailures >= thresholds.jobFailureThreshold) {
    alerts.push({
      rule: "job_failures",
      severity: "critical",
      summary: `${jobFailures} job failure(s) recorded`,
      value: jobFailures,
    });
  }

  return alerts;
}

/** Prometheus text exposition for the same snapshot. */
export function renderPrometheus(snapshot: MetricsSnapshot): string {
  const lines: string[] = [];

  lines.push("# HELP http_requests_total Requests by route and status class.");
  lines.push("# TYPE http_requests_total counter");
  for (const row of snapshot.requests) {
    lines.push(
      `http_requests_total{route="${row.route}",status="${row.statusClass}"} ${row.count}`,
    );
  }

  lines.push("# HELP http_request_duration_ms Request latency percentiles.");
  lines.push("# TYPE http_request_duration_ms gauge");
  for (const series of snapshot.latency) {
    lines.push(
      `http_request_duration_ms{route="${series.route}",quantile="0.5"} ${percentile(series.values, 50).toFixed(0)}`,
    );
    lines.push(
      `http_request_duration_ms{route="${series.route}",quantile="0.95"} ${percentile(series.values, 95).toFixed(0)}`,
    );
    lines.push(
      `http_request_duration_ms{route="${series.route}",quantile="0.99"} ${percentile(series.values, 99).toFixed(0)}`,
    );
  }

  for (const row of snapshot.counters) {
    const labels = Object.entries(row.labels)
      .map(([key, value]) => `${key}="${value}"`)
      .join(",");
    lines.push(`${row.name}${labels ? `{${labels}}` : ""} ${row.value}`);
  }

  return `${lines.join("\n")}\n`;
}
