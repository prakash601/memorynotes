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
| Phase 2 - Core Note Product | #16-#25 | 0    | 10   |

## Phase 1 - Foundation

Goal: an empty but real product: repo, deploy, login, database.

| #   | Issue                                                       | Status | Commit      |
| --- | ----------------------------------------------------------- | ------ | ----------- |
| 1   | Scaffold Next.js app with TypeScript and App Router         | Done   | 9d53da3     |
| 2   | Add ESLint, Prettier, and strict TypeScript config          | Done   | 26da466     |
| 3   | Add CI pipeline: lint, typecheck, test, build               | Done   | 727a67e     |
| 4   | Add typed environment config and .env.example               | Done   | 3934315     |
| 5   | Set up Drizzle ORM, Postgres client, and migration tooling  | Done   | 742209f     |
| 6   | Define database enums and the users table                   | Done   | 10b741d     |
| 7   | Define notes, drafts, and versions tables                   | Done   | e613158     |
| 8   | Define shares, leases, API tokens, and OAuth tables         | Done   | 716db59     |
| 9   | Define reports, moderation events, and activity log tables  | Done   | 33033c8     |
| 10  | Add schema integrity test asserting tables match the design | Done   | 4f197ab     |
| 11  | Add Auth.js with Google and GitHub providers                | Done   | 44883c3     |
| 12  | Add session handling and CSRF protection                    | Done   | f3f3fe0     |
| 13  | Establish the framework-free core module boundary           | Done   | c0186a9     |
| 14  | Add health check endpoint                                   | Done   | 34725e7     |
| 15  | Add repository tracking file for issue status               | Done   | see git log |

## Phase 2 - Core Note Product

Goal: the wedge works end to end: create, publish, share, read, edit.

| #   | Issue                                                                  | Status |
| --- | ---------------------------------------------------------------------- | ------ |
| 16  | Create note API that provisions its canonical share in one transaction | Open   |
| 17  | Draft autosave with optimistic concurrency and 409 conflicts           | Open   |
| 18  | Publish creates immutable versions                                     | Open   |
| 19  | Version history list and non-destructive restore                       | Open   |
| 20  | Markdown editor UI with code block support                             | Open   |
| 21  | Public read page on the share domain with strict headers               | Open   |
| 22  | Visibility controls: unlisted, public, private                         | Open   |
| 23  | Link expiry options, extension, and gone page                          | Open   |
| 24  | Soft delete with a 30-day purge job                                    | Open   |
| 25  | Dashboard: list, open, rename, and delete notes                        | Open   |

## Verification

Phase 1 exit checks, run locally on 2026-09-14:

| Check         | Command                                             | Result                                          |
| ------------- | --------------------------------------------------- | ----------------------------------------------- |
| Lint          | `npm run lint`                                      | pass                                            |
| Types         | `npm run typecheck`                                 | pass                                            |
| Format        | `npm run format:check`                              | pass                                            |
| Unit tests    | `npm test`                                          | 9 pass, 3 skipped                               |
| Build         | `npm run build`                                     | pass, 5 routes                                  |
| Core boundary | ESLint probe importing `next/headers` in `src/core` | correctly rejected                              |
| Migrations    | `npm run db:generate`                               | 17 tables, 24 foreign keys, all partial indexes |

The 3 skipped tests are the schema integrity tests, which skip when
`DATABASE_URL` is absent. They run for real in CI against the Postgres service.

### CI

Green on `main`: run 34818442868 (commit 010dfc1). CI applies the migrations to
a Postgres 16 service container, runs the schema integrity tests against it, and
builds the app. This is the first proof the migration applies to a real database
and that the schema tests pass with a live schema.

One warning remains: `actions/checkout@v4` and `actions/setup-node@v4` target
Node 20, which GitHub now forces onto Node 24. Not a failure, but they should be
bumped to v5.

### Not yet verified

- Google and GitHub sign-in have not been exercised with real provider
  credentials. The Auth.js config, Drizzle adapter wiring, and route handlers are
  in place and type-check, but "sign in works end to end" is unproven, so issue
  #11's acceptance criterion is only partly met.
- No deployment exists yet. The roadmap's Phase 1 exit criterion "staging is
  reachable on both domains" is not met, and the share-domain split (ADR-0007)
  needs a domain decision before it can be.

## Notes and deviations

- `next-env.d.ts` is committed (the Next 16 scaffold gitignores it). Committing
  it keeps type checking deterministic on a fresh checkout.
- Email uniqueness uses `text` with a `lower(email)` unique index instead of the
  `citext` type. Same behavior, no extension dependency.
- Auth.js table field names (`name`, `email`, `emailVerified`, `image`) are
  fixed by the adapter; database columns stay snake_case.
- `tsconfig.tsbuildinfo` is generated and ignored.
- Peer-install note for later: `@auth/drizzle-adapter` is on 1.x; re-check it
  when `next-auth` v5 leaves beta.

## Open items carried from the design docs

These do not block Phase 2 but are tracked so they are not lost.

| Item                                          | Source           | Target                |
| --------------------------------------------- | ---------------- | --------------------- |
| Link token design review                      | S5               | Phase 2               |
| Prompt-injection hardening                    | S11              | Phase 5               |
| Email verification before public indexing     | A5               | Phase 3               |
| Moderation vendor selection                   | A6               | Phase 3               |
| Rate-limit numbers                            | A6               | Phase 3               |
| Secrets rotation                              | S13              | Phase 6               |
| Dependency scanning and pentest               | S14              | Phase 6               |
| Domain selection and DNS for the share domain | doc 00, ADR-0007 | Before Phase 2 deploy |

## How to keep this current

1. When starting an issue, set it to In progress here and on GitHub.
2. When the work lands, set it to Done and add the commit hash.
3. Update the milestone counts.
4. If a check has not actually been run, say so rather than marking it Done.
