# Runbook: incident response

Applies to outages, abuse spikes, and security events. Staffing is best effort
and stated honestly in the policy (doc 06, A10).

## Severity

| Level | Meaning                                           | Response target   |
| ----- | ------------------------------------------------- | ----------------- |
| SEV1  | Public read or create is down, or data is at risk | Immediate         |
| SEV2  | A major feature is degraded (MCP, sharing, jobs)  | Same day          |
| SEV3  | Minor degradation or a single-account issue       | Next business day |

## First 15 minutes

1. **Acknowledge.** Open an incident note with the time, the symptom, and who is
   responding.
2. **Assess.** Check `/status`, `/api/health`, and the metrics endpoint
   (`GET /api/metrics` with the scheduler secret). Look for a fired alert
   (`POST /api/v1/jobs/alerts` shows what the rules see).
3. **Contain.** Stop the bleeding first: disable the failing job, revoke a
   compromised token, or take the affected surface offline. A degraded product
   beats a leaky one.

## Comms

- Update `/status` for user-visible impact.
- Support goes to the `SUPPORT_EMAIL` address.
- For anything touching personal data, follow `breach-notification.md`.

## Signals and alerts

- Error rate: `http_requests_total` 5xx share over 5%.
- Latency: p95 above 500ms.
- Jobs: any `job_failures_total` increment (purge, alerts).
- Alerts dispatch to the log and to `ALERT_WEBHOOK_URL` when configured.

## After

1. Restore service and confirm the metrics return to baseline.
2. Write a short post-mortem: cause, impact, detection, fix, follow-ups.
3. File follow-up work before closing the incident.

## Rehearsal

Rehearse once before launch with a simulated SEV2 (for example, the purge job
failing) and time the detect-to-contain path.

- Last rehearsed: not yet.
