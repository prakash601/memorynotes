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

| Milestone                   | Issues  | Done | Open |
| --------------------------- | ------- | ---- | ---- |
| Phase 1 - Foundation        | #1-#15  | 15   | 0    |
| Phase 2 - Core Note Product | #16-#25 | 10   | 0    |

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

## Verification

Run locally on 2026-09-14 against a Postgres 16.15 container.

| Check         | Command                                             | Result                     |
| ------------- | --------------------------------------------------- | -------------------------- |
| Lint          | `npm run lint`                                      | pass                       |
| Types         | `npm run typecheck`                                 | pass                       |
| Format        | `npm run format:check`                              | pass                       |
| Migrations    | `npm run db:migrate`                                | applied to a real database |
| Tests         | `npm test`                                          | 57 pass, 0 skipped         |
| Build         | `npm run build`                                     | pass, 18 routes            |
| Core boundary | ESLint probe importing `next/headers` in `src/core` | correctly rejected         |

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
- No deployment exists yet, so the share-domain split (ADR-0007) is only
  implemented as a configurable `SHARE_DOMAIN`, not as separate infrastructure.

## Notes and deviations

- Share tokens are stored as a SHA-256 hash for lookup and, additionally, as
  AES-256-GCM ciphertext so the owner can re-display their own link. Without the
  ciphertext the dashboard could never show a URL again.
- The public read page is a route handler returning raw HTML rather than a React
  page, so it can ship a CSP with `script-src 'none'`.
- Email uniqueness uses `text` with a `lower(email)` unique index instead of
  `citext`.
- `next-env.d.ts` is committed; `tsconfig.tsbuildinfo` is ignored.
- `@auth/drizzle-adapter` is on 1.x and `next-auth` on 5.0.0-beta; re-check both
  when the beta ends.

## Open items carried from the design docs

| Item                                                         | Source           | Target        |
| ------------------------------------------------------------ | ---------------- | ------------- |
| Edit the note from a share link in the UI (core rule exists) | doc 12           | Phase 3       |
| Prompt-injection hardening                                   | S11              | Phase 5       |
| Email verification before public indexing                    | A5               | Phase 3       |
| Moderation vendor selection                                  | A6               | Phase 3       |
| Rate-limit numbers                                           | A6               | Phase 3       |
| Secrets rotation                                             | S13              | Phase 6       |
| Dependency scanning and pentest                              | S14              | Phase 6       |
| Domain selection and DNS for the share domain                | doc 00, ADR-0007 | Before deploy |
| Bump `actions/checkout` and `actions/setup-node` to v5       | CI warning       | Phase 3       |

## How to keep this current

1. When starting an issue, set it to In progress here and on GitHub.
2. When the work lands, set it to Done and add the commit hash.
3. Update the milestone counts.
4. If a check has not actually been run, say so rather than marking it Done.
