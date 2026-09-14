# Tracking

Status of every tracked issue for MemoryNotes. This file is the single view of
what is done, what is in progress, and what is next.

Last updated: 2026-09-14

## Legend

| Status      | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| Done        | Implemented, merged to `main`, and covered by the phase checks |
| In progress | Actively being worked on                                       |
| Open        | Not started                                                    |
| Blocked     | Cannot proceed until something else lands                      |

## Milestones

| Milestone                    | Issues  | Done | Open |
| ---------------------------- | ------- | ---- | ---- |
| Phase 1 - Foundation         | #1-#15  | 15   | 0    |
| Phase 2 - Core Note Product  | #16-#25 | 10   | 0    |
| Phase 3 - Safety             | #26-#34 | 9    | 0    |
| Phase 4 - Public API         | #35-#40 | 6    | 0    |
| Phase 5 - MCP and connectors | #41-#45 | 5    | 0    |
| Phase 6 - Launch readiness   | #46-#51 | 6    | 0    |

## Phase 1 - Foundation

Goal: an empty but real product: repo, deploy, login, database.

| #   | Issue                                                       | Status | Commit  |
| --- | ----------------------------------------------------------- | ------ | ------- |
| 1   | Scaffold Next.js app with TypeScript and App Router         | Done   | 9d53da3 |
| 2   | Add ESLint, Prettier, and strict TypeScript config          | Done   | 26da466 |
| 3   | Add CI pipeline: lint, typecheck, test, build               | Done   | 727a67e |
| 4   | Add typed environment config and .env.example               | Done   | 3934315 |
| 5   | Set up Drizzle ORM, Postgres client, and migration tooling  | Done   | 742209f |
| 6   | Define database enums and the users table                   | Done   | 10b741d |
| 7   | Define notes, drafts, and versions tables                   | Done   | e613158 |
| 8   | Define shares, leases, API tokens, and OAuth tables         | Done   | 716db59 |
| 9   | Define reports, moderation events, and activity log tables  | Done   | 33033c8 |
| 10  | Add schema integrity test asserting tables match the design | Done   | 4f197ab |
| 11  | Add Auth.js with Google and GitHub providers                | Done   | 44883c3 |
| 12  | Add session handling and CSRF protection                    | Done   | f3f3fe0 |
| 13  | Establish the framework-free core module boundary           | Done   | c0186a9 |
| 14  | Add health check endpoint                                   | Done   | 34725e7 |
| 15  | Add repository tracking file for issue status               | Done   | c2aefac |

## Phase 2 - Core Note Product

Goal: the wedge works end to end: create, publish, share, read, edit.

| #   | Issue                                                                  | Status | Commit                             |
| --- | ---------------------------------------------------------------------- | ------ | ---------------------------------- |
| 16  | Create note API that provisions its canonical share in one transaction | Done   | 8c98fbd, fe85607                   |
| 17  | Draft autosave with optimistic concurrency and 409 conflicts           | Done   | 8c98fbd, fe85607, 736203e          |
| 18  | Publish creates immutable versions                                     | Done   | 8c98fbd, fe85607                   |
| 19  | Version history list and non-destructive restore                       | Done   | 8c98fbd, fe85607, 736203e          |
| 20  | Markdown editor UI with code block support                             | Done   | 736203e                            |
| 21  | Public read page on the share domain with strict headers               | Done   | f2bcf29                            |
| 22  | Visibility controls: unlisted, public, private                         | Done   | 8c98fbd, fe85607, 736203e          |
| 23  | Link expiry options, extension, and gone page                          | Done   | ffeba0f, 8c98fbd, fe85607, 736203e |
| 24  | Soft delete with a 30-day purge job                                    | Done   | 8c98fbd, fe85607                   |
| 25  | Dashboard: list, open, rename, and delete notes                        | Done   | 736203e                            |

## Phase 3 - Safety, privacy, and compliance

Goal: the controls that make public links survivable.

| #   | Issue                                                               | Status | Commit           |
| --- | ------------------------------------------------------------------- | ------ | ---------------- |
| 26  | Serve user content only from the share domain (ADR-0007)            | Done   | 78a5cca, b672aba |
| 27  | Moderation on create, patch, and commit with hash matching and CSAM | Done   | b672aba          |
| 28  | Reports: button, triage queue, SLA, takedown, and appeal            | Done   | b672aba, 78a5cca |
| 29  | Rate limits from doc 06 with 429 and Retry-After                    | Done   | b672aba, 78a5cca |
| 30  | Self-serve export (JSON plus markdown) and account delete           | Done   | b672aba, 78a5cca |
| 31  | Policy pages: AUP, Terms, Privacy, and subprocessors                | Done   | 78a5cca          |
| 32  | Edit a note from a share link in the UI                             | Done   | b672aba, 78a5cca |
| 33  | Gate public indexing on a verified email (A5)                       | Done   | b672aba          |
| 34  | Bump CI actions to v5                                               | Done   | 2906122          |

## Phase 4 - Public API and tokens

Goal: the canonical HTTP contract, usable without a browser.

| #   | Issue                                                         | Status | Commit                    |
| --- | ------------------------------------------------------------- | ------ | ------------------------- |
| 35  | Personal API tokens: create, list, revoke, scopes, shown once | Done   | 4588ddf, 068489c, 42f355f |
| 36  | Bearer token auth and scope enforcement across /api/v1        | Done   | 4588ddf, 068489c          |
| 37  | Idempotency keys on writes                                    | Done   | 4588ddf, 068489c          |
| 38  | Cursor pagination that is stable across pages                 | Done   | 4588ddf, 068489c          |
| 39  | Lease endpoints for agent writes                              | Done   | 4588ddf, 068489c          |
| 40  | Public JSON read endpoint and /api/v1 contract tests          | Done   | 068489c, 3687cd2          |

## Phase 5 - MCP and platform connectors

Goal: ChatGPT (and later platforms) can create and share notes for the user.

| #   | Issue                                                             | Status | Commit           |
| --- | ----------------------------------------------------------------- | ------ | ---------------- |
| 41  | OAuth 2.1 server: metadata, dynamic client registration, and PKCE | Done   | 9d09cc0, 603a330 |
| 42  | Consent screen and immediate token revocation                     | Done   | 2e09f63, 9d09cc0 |
| 43  | Accept OAuth access tokens across the API                         | Done   | 603a330          |
| 44  | MCP Streamable HTTP endpoint with the 12-tool surface             | Done   | 9d09cc0, 603a330 |
| 45  | Connector fallback and MCP/OAuth contract tests                   | Done   | 0f7642b          |

## Phase 6 - Launch readiness

Goal: safe to open signups.

| #   | Issue                                                     | Status | Commit           |
| --- | --------------------------------------------------------- | ------ | ---------------- |
| 46  | Structured logging, metrics, error tracking, and alerting | Done   | c911538, 00a3a91 |
| 47  | Non-breaking secret rotation (S13)                        | Done   | c911538, 00a3a91 |
| 48  | CI dependency scanning, SAST, and Dependabot (S14)        | Done   | 9be2fa5          |
| 49  | Load and DoS test tooling with recorded targets           | Done   | c2c57fc          |
| 50  | Status page, support path, and security disclosure        | Done   | c911538, 9be2fa5 |
| 51  | Runbooks and launch gate checklist                        | Done   | c2c57fc          |

## Verification

Run locally on 2026-09-14 against a Postgres 16.15 container.

| Check         | Command                                             | Result                     |
| ------------- | --------------------------------------------------- | -------------------------- |
| Lint          | `npm run lint`                                      | pass                       |
| Types         | `npm run typecheck`                                 | pass                       |
| Format        | `npm run format:check`                              | pass                       |
| Migrations    | `npm run db:migrate`                                | applied to a real database |
| Tests         | `npm test`                                          | 140 pass, 0 skipped        |
| Build         | `npm run build`                                     | pass, 48 routes plus proxy |
| Core boundary | ESLint probe importing `next/headers` in `src/core` | correctly rejected         |

Phase 3 checks:

| Check                  | Evidence                                                               | Result                      |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------- |
| Content domain         | `tests/domains.test.ts`; proxy plus route-level re-check               | pass                        |
| Moderation write paths | `tests/notes.test.ts` (create, patch, commit) and `moderation.test.ts` | blocked returns 422         |
| Reports and takedown   | `tests/reports.test.ts`; read-page report link                         | takedown hides and notifies |
| Rate limits            | `tests/rate-limit.test.ts`; headers observed on `POST /api/v1/reports` | 429 with Retry-After        |
| Export and delete      | `tests/account.test.ts`                                                | purges notes and versions   |
| Policy pages           | `/aup`, `/terms`, `/privacy`, `/subprocessors`                         | live, HTTP 200              |
| Share-link editing     | read page emits an edit link; `getNoteView` honors the token           | pass                        |
| Email gate (A5)        | `tests/notes.test.ts`                                                  | `email_not_verified`        |

Phase 4 checks:

| Check             | Evidence                                                            | Result                           |
| ----------------- | ------------------------------------------------------------------- | -------------------------------- |
| Token lifecycle   | `tests/api-tokens.test.ts`; `/settings/tokens` UI                   | create, list, revoke, shown once |
| Bearer and scopes | `tests/api-contract.test.ts`                                        | `notes:read` cannot write (403)  |
| Idempotent retry  | `tests/api-contract.test.ts`; live retry returned an identical body | does not double-apply            |
| Cursor pagination | `tests/pagination.test.ts`; `/api/v1/notes?limit=`                  | stable across pages              |
| Leases            | `tests/leases.test.ts`; live acquire over HTTP                      | expiry, commit, abort            |
| Public JSON read  | `GET /api/v1/public/notes/{token}`; `tests/api-contract.test.ts`    | 200, private refused             |

Phase 5 checks:

| Check                    | Evidence                                                           | Result                        |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------- |
| OAuth authorization code | `tests/oauth.test.ts`; live discovery, registration, authorize 302 | PKCE S256, single-use codes   |
| Second client, no change | `tests/oauth.test.ts`; two dynamically registered clients          | pass                          |
| Immediate revocation     | `tests/oauth.test.ts`; consent revoke kills tokens                 | access token rejected         |
| 12 MCP tools             | `tests/mcp.test.ts`; live `tools/list`                             | 12 tools                      |
| create_note share URL    | `tests/mcp.test.ts`; live `tools/call`                             | working `/n/` URL             |
| Killed agent             | `tests/leases.test.ts`                                             | note unchanged, lease expires |
| notes:read cannot write  | `tests/mcp.test.ts`                                                | publish/delete denied         |
| Plain API fallback       | `tests/mcp.test.ts`; OAuth token on `/api/v1/notes`                | 200                           |

Phase 6 checks:

| Check              | Evidence                                                            | Result                         |
| ------------------ | ------------------------------------------------------------------- | ------------------------------ |
| Alert rules        | `tests/metrics.test.ts`                                             | error rate, latency, jobs fire |
| Metrics endpoint   | `GET /api/metrics` guarded by the scheduler secret                  | 401 without, text with         |
| Job failure signal | purge/alerts record `job_failures_total`                            | feeds the alert rule           |
| Key rotation       | `tests/secrets.test.ts`                                             | old ciphertext still decrypts  |
| CI scanning        | `.github/workflows/ci.yml` audit plus CodeQL; Dependabot configured | runs on push and PR            |
| Load test          | `npm run load:test`; read path at 10 concurrent                     | p95 47ms, 0 errors, target met |
| Status and support | `/status` returns 200; `SUPPORT_EMAIL` in the footer                | live                           |
| Runbooks           | `runbooks/*` and `LAUNCH_CHECKLIST.md`                              | written, rehearsal pending     |

The test suite now runs in full locally because a database was available:
`docker run -d --name mn-pg -p 5433:5432 -e POSTGRES_PASSWORD=postgres
-e POSTGRES_USER=postgres -e POSTGRES_DB=memorynotes_test postgres:16`, then
`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/memorynotes_test`.

Two bugs were caught by actually running the integration tests, which is why
this matters: an untyped `Date` passed through a raw `sql` template crashed the
purge job, and `rel`/`target` were stripped from rendered links because they
were missing from the sanitizer allowlist.

### Not yet verified

- Google and GitHub sign-in have still not been exercised with real provider
  credentials. The wiring type-checks and the session callback is in place, but
  "sign in works end to end" remains unproven.
- No deployment exists yet, so the share-domain split (ADR-0007) is enforced by
  the proxy and the read route as a configurable `SHARE_DOMAIN`, not as separate
  infrastructure.
- The moderation vendor is not selected. The `Moderator` seam and the built-in
  local provider (hash matching plus blocked terms) are live, but the real
  known-materials hash feed and vendor are required before public signups
  (launch gate 2).
- Rate-limit counters use the in-memory driver. Redis is the documented
  production driver and is a drop-in behind `RateLimitStore`, but no Redis is
  provisioned yet.
- Idempotency keys use the same in-memory pattern (`IdempotencyStore`); doc 03
  puts them in Redis too.
- Takedown notifications go through the logging notifier; no email provider is
  wired.
- The ChatGPT connector has not been run against the real platform, and the
  directory listing is deferred. MCP is exercised with a generic JSON-RPC
  client, which is the same contract the connector uses.
- OAuth consent is covered through the core services and the token endpoints,
  but the human consent click and the Auth.js return after `next` have not run
  in a browser with real provider credentials.
- MCP is JSON-RPC over POST. Server-initiated SSE (GET) is not implemented.
- No external penetration test has run. CI scanning and `SECURITY.md` are in
  place; gate 7 is pending.
- An external error tracker and a pager are not connected. Alerts dispatch to
  the structured log and to `ALERT_WEBHOOK_URL` when one is set.
- The create path was not load-tested locally because the per-account cap is
  50/day; only the read path was measured.
- The runbooks are written but none has been rehearsed.

## Notes and deviations

- Share tokens are stored as a SHA-256 hash for lookup and, additionally, as
  AES-256-GCM ciphertext so the owner can re-display their own link. Without the
  ciphertext the dashboard could never show a URL again.
- The public read page is a route handler returning raw HTML rather than a React
  page, so it can ship a CSP with `script-src 'none'`.
- Email uniqueness uses `text` with a `lower(email)` unique index instead of
  `citext`.
- `next-env.d.ts` and `tsconfig.tsbuildinfo` are ignored. Next rewrites
  `next-env.d.ts` to point at `.next/dev/types` in development and
  `.next/types` in a build, so tracking it guarantees a dirty tree.
- `@auth/drizzle-adapter` is on 1.x and `next-auth` on 5.0.0-beta; re-check both
  when the beta ends.
- Moderation depends on a `Moderator` seam. The built-in provider does exact
  known-materials hash matching (the CSAM gate) plus configured blocked terms.
  A vendor adapter replaces it without touching create, patch, or commit.
- Takedown is a soft delete plus a link revoke, not a hard delete, so the appeal
  path has something to review.
- ADR-0007 is enforced in `src/proxy.ts`. Next 16 renamed the `middleware` file
  convention to `proxy`; the read route re-checks the same rule.
- `ADMIN_EMAILS` controls the moderation queue. With it unset, the queue is
  empty and no account is a moderator.
- Rate-limit numbers live in `src/core/rate-limit.ts` and use a fixed window.
  The store is in-memory locally and Redis in production (ADR-0009).
- The subprocessor list marks vendors that are still to be selected instead of
  naming ones we do not use.
- `/api/v1` accepts either a Bearer token or the session cookie. Token callers
  are scope-checked; a session is the owner and has every scope.
- Token management and account delete are session-only on purpose. A leaked API
  token cannot mint or revoke tokens, and cannot destroy an account. This is a
  deliberate deviation from doc 09, where those endpoints list `bearer`.
- An idempotent replay returns the stored response with an
  `Idempotency-Replayed: true` header; a repeated key with a different body is a
  `422`.
- Bearer auth routes by prefix: personal API tokens are `mn_`, OAuth access
  tokens are `oa_`, and refresh tokens are `or_`. The two token kinds share one
  Principal and one scope model.
- OAuth discovery lives at `/.well-known/oauth-authorization-server` and
  `/.well-known/oauth-protected-resource`. A leading-dot folder is not a valid
  Next route segment, so they are served from API routes through rewrites.
- The MCP tool surface is `src/core/mcp.ts`, not the HTTP route. The route only
  speaks JSON-RPC, so another platform reuses the tools without a core change
  (ADR-0006).
- `begin_edit`, `append_edit`, and `commit_edit` stage against the lease. The
  draft is untouched until commit; an abort or an expiry discards staging.
- Metrics and logs live in-process (`src/lib/metrics.ts`, `src/lib/logger.ts`).
  The registry exposes a Prometheus text endpoint behind the scheduler secret;
  production can export the same snapshot to a real backend.
- Alert thresholds (5% 5xx, p95 500ms, any job failure) live in
  `src/lib/metrics.ts` and are evaluated by the scheduled alerts endpoint.
- The share-token key set is `SHARE_TOKEN_SECRETS`, newest first. Dropping an
  old key breaks display (not resolution) of links encrypted with it; rotate a
  link if that happens.

## Open items carried from the design docs

Resolved in Phase 3: share-link editing in the UI, email verification before
public indexing (A5), rate-limit numbers (A6), and the CI action bump.
Resolved in Phase 5: prompt-injection framing (S11) and the OAuth 2.1 server.
Resolved in Phase 6 (code): observability and alerting, secret rotation (S13),
and CI scanning (S14).

| Item                                             | Source           | Target                |
| ------------------------------------------------ | ---------------- | --------------------- |
| External penetration test                        | S14              | Before launch         |
| ChatGPT connector end-to-end and directory list  | doc 10           | Before launch         |
| Moderation vendor and known-materials hash feed  | A6               | Before public signups |
| Redis driver for rate limits and idempotency     | doc 03, ADR-0009 | Before public signups |
| Email provider for takedown notifications        | A8               | Before public signups |
| Error tracker and pager connected to alerts      | NFR-5            | Before public signups |
| Rehearse takedown, breach, and incident runbooks | doc 11           | Before launch         |
| Domain selection and DNS for the share domain    | doc 00, ADR-0007 | Before deploy         |

## How to keep this current

1. When starting an issue, set it to In progress here and on GitHub.
2. When the work lands, set it to Done and add the commit hash.
3. Update the milestone counts.
4. If a check has not actually been run, say so rather than marking it Done.
