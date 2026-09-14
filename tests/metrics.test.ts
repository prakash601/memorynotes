import { describe, expect, it } from "vitest";
import {
  MetricsRegistry,
  evaluateAlerts,
  percentile,
  renderPrometheus,
  type MetricsSnapshot,
} from "@/lib/metrics";

function snapshot(partial: Partial<MetricsSnapshot>): MetricsSnapshot {
  return { requests: [], latency: [], counters: [], ...partial };
}

describe("alert rules", () => {
  it("stays quiet on a healthy snapshot", () => {
    const alerts = evaluateAlerts(
      snapshot({
        requests: [{ route: "read.note", statusClass: "2xx", count: 100 }],
        latency: [{ route: "read.note", values: Array(100).fill(40) }],
      }),
    );
    expect(alerts).toEqual([]);
  });

  it("fires on error rate above the threshold", () => {
    const alerts = evaluateAlerts(
      snapshot({
        requests: [
          { route: "notes.create", statusClass: "2xx", count: 90 },
          { route: "notes.create", statusClass: "5xx", count: 10 },
        ],
      }),
    );
    expect(alerts).toContainEqual(
      expect.objectContaining({ rule: "error_rate", severity: "critical" }),
    );
  });

  it("does not fire on error rate before enough samples", () => {
    const alerts = evaluateAlerts(
      snapshot({
        requests: [
          { route: "notes.create", statusClass: "2xx", count: 1 },
          { route: "notes.create", statusClass: "5xx", count: 1 },
        ],
      }),
    );
    expect(alerts.find((alert) => alert.rule === "error_rate")).toBeUndefined();
  });

  it("fires on p95 latency above the threshold", () => {
    const alerts = evaluateAlerts(
      snapshot({
        requests: [{ route: "read.note", statusClass: "2xx", count: 50 }],
        latency: [{ route: "read.note", values: Array(50).fill(800) }],
      }),
    );
    expect(alerts).toContainEqual(expect.objectContaining({ rule: "latency" }));
  });

  it("fires on job failures", () => {
    const alerts = evaluateAlerts(
      snapshot({
        counters: [{ name: "job_failures_total", labels: { job: "purge" }, value: 3 }],
      }),
    );
    expect(alerts).toContainEqual(
      expect.objectContaining({ rule: "job_failures", severity: "critical" }),
    );
  });
});

describe("metrics registry", () => {
  it("aggregates requests and latency by route", () => {
    const registry = new MetricsRegistry();
    registry.recordRequest("read.note", 200, 10);
    registry.recordRequest("read.note", 500, 30);
    registry.increment("job_failures_total", { job: "purge" });

    const snap = registry.snapshot();
    expect(snap.requests).toHaveLength(2);
    expect(snap.latency[0].values).toEqual([10, 30]);
    expect(snap.counters[0]).toEqual({
      name: "job_failures_total",
      labels: { job: "purge" },
      value: 1,
    });
  });

  it("computes percentiles", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([100, 200, 300], 95)).toBe(300);
    expect(percentile([], 95)).toBe(0);
  });

  it("renders Prometheus text", () => {
    const registry = new MetricsRegistry();
    registry.recordRequest("read.note", 200, 25);
    const text = renderPrometheus(registry.snapshot());

    expect(text).toContain('http_requests_total{route="read.note",status="2xx"} 1');
    expect(text).toContain("http_request_duration_ms");
    expect(text).toContain('quantile="0.95"');
  });
});
