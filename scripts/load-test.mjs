#!/usr/bin/env node
/**
 * Small dependency-free load test for the read and create paths.
 *
 * Usage:
 *   node scripts/load-test.mjs --url http://localhost:3000/n/<token> --concurrency 10 --duration 10
 *   node scripts/load-test.mjs --url http://localhost:3000/api/v1/notes --method POST \
 *     --token mn_xxx --data '{"title":"load","content":"# load"}'
 *
 * Targets (doc 01):
 *   read p95  <= 200ms, create p95 <= 500ms, error rate <= 1%.
 */
const args = parseArgs(process.argv.slice(2));

const url = args.url ?? "http://localhost:3000/";
const method = (args.method ?? "GET").toUpperCase();
const concurrency = Number(args.concurrency ?? 10);
const durationSec = Number(args.duration ?? 10);
const token = args.token;

const targets =
  method === "GET" ? { p95Ms: 200, maxErrorRate: 0.01 } : { p95Ms: 500, maxErrorRate: 0.01 };

const latencies = [];
const statuses = new Map();
let done = false;
let total = 0;
let errors = 0;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith("--")) {
      out[key.slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
    }
  }
  return out;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function worker() {
  while (!done) {
    const start = performance.now();
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(method === "GET" ? {} : { "content-type": "application/json" }),
        },
        body: method === "GET" ? undefined : (args.data ?? "{}"),
      });
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      total += 1;
      if (response.status >= 500) errors += 1;
      // Drain the body so the connection is reusable.
      await response.arrayBuffer();
    } catch {
      total += 1;
      errors += 1;
      latencies.push(performance.now() - start);
    }
  }
}

const started = Date.now();
setTimeout(() => {
  done = true;
}, durationSec * 1000);

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const wallMs = Date.now() - started;
const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);
const p99 = percentile(latencies, 99);
const rps = (total / wallMs) * 1000;
const errorRate = total === 0 ? 0 : errors / total;

console.log(`target   ${method} ${url}`);
console.log(`requests ${total} in ${wallMs}ms (${rps.toFixed(0)} rps, concurrency ${concurrency})`);
console.log(`latency  p50 ${p50.toFixed(0)}ms  p95 ${p95.toFixed(0)}ms  p99 ${p99.toFixed(0)}ms`);
console.log(`statuses ${[...statuses.entries()].map(([s, n]) => `${s}:${n}`).join(" ") || "none"}`);
console.log(`errors   ${errors} (${(errorRate * 100).toFixed(2)}%)`);
console.log(
  `targets  p95 <= ${targets.p95Ms}ms, error rate <= ${(targets.maxErrorRate * 100).toFixed(0)}%`,
);

const passed = p95 <= targets.p95Ms && errorRate <= targets.maxErrorRate;
console.log(passed ? "PASS" : "FAIL");
process.exit(passed ? 0 : 1);
