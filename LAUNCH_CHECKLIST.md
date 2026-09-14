# Launch gate checklist

Do not open public signups until every gate is true. This file records what the
code provides and what still needs a human or an external service.

Last reviewed: 2026-09-14

## Gates (doc 11)

| #   | Gate                                                      | State                      | Notes                                                                                                                                            |
| --- | --------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Share domain separated; no user content on the app domain | Code done, deploy pending  | `src/proxy.ts` plus a read-route re-check; the split is real only once two domains exist.                                                        |
| 2   | Moderation, hash matching, and CSAM reporting path live   | Partial                    | `Moderator` seam, hash matching, and the reporting path in the AUP are live. The real vendor and known-materials feed are not wired.             |
| 3   | Rate limits active                                        | Done (single instance)     | Doc 06 limits enforced with `429` and `Retry-After`. Counters are in-memory; Redis is required before more than one instance.                    |
| 4   | Export and delete working                                 | Done                       | JSON plus markdown export and account delete, both tested.                                                                                       |
| 5   | AUP, Terms, and Privacy published                         | Done                       | Live at `/aup`, `/terms`, `/privacy`, plus `/subprocessors`.                                                                                     |
| 6   | Observability and alerting live                           | Code done, service pending | Structured logs, `/api/metrics`, alert rules for error rate, latency, and job failures. An external error tracker and a pager are not connected. |
| 7   | Pentest complete with high findings resolved              | Pending                    | External engagement. `SECURITY.md` and CI scanning are in place.                                                                                 |

## Phase 6 work

| Item                                              | State                          |
| ------------------------------------------------- | ------------------------------ |
| Structured logs, metrics, error seam, alert rules | Done, tested                   |
| Non-breaking share-key rotation (S13)             | Done, tested                   |
| Dependency audit and CodeQL in CI (S14)           | Config in CI                   |
| Dependabot for npm and Actions                    | Config in CI                   |
| Load-test tooling and recorded targets            | Script plus targets in doc 01  |
| Status page and support path                      | `/status` plus `SUPPORT_EMAIL` |
| Vulnerability disclosure policy                   | `SECURITY.md`                  |
| Takedown, breach, incident, rotation runbooks     | Written, rehearsal pending     |
| Penetration test                                  | Pending (external)             |

## Human sign-off

- [ ] Staging is reachable on both domains; sign-in works with real provider
      credentials.
- [ ] A moderation vendor and known-materials hash feed are selected and wired.
- [ ] Redis is provisioned for rate limits and idempotency.
- [ ] An external pentest is complete and high findings are fixed.
- [ ] The takedown, breach, and incident runbooks are rehearsed once.
- [ ] A pager and error tracker are connected to the alert webhook.

Signed off by: _not yet_
