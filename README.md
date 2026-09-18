# MemoryNotes

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Shareable memory for your agents.**

Notes App (package name `memorynotes`) is an AI-native note product. Any agent
can write to a note over MCP, and the result is a link you can hand to someone.
Every note is versioned, every note gets a share link at birth, and MCP is just
another author. The editor is table stakes; the **agent-writes / you-share**
loop is the product.

The HTTP API is the canonical contract. MCP is one adapter over it, so adding a
platform is an adapter task rather than a core change (ADR-0006).

## Repository structure

```text
memorynotes/
├── src/
│   ├── app/                      Next.js App Router: pages, layouts, and HTTP routes
│   │   ├── (legal)/              Policy pages: AUP, Terms, Privacy, Subprocessors
│   │   ├── admin/reports/        Moderation triage queue
│   │   ├── api/
│   │   │   ├── auth/             Auth.js handler
│   │   │   ├── dev-login/        Dev-only passwordless sign-in
│   │   │   ├── health/           Health check
│   │   │   ├── mcp/              MCP Streamable HTTP endpoint (JSON-RPC 2.0)
│   │   │   ├── metrics/          Metrics endpoint, guarded by the scheduler secret
│   │   │   ├── oauth/            OAuth 2.1: metadata, authorize, token, register, revoke
│   │   │   └── v1/               Canonical HTTP API
│   │   │       ├── csrf/         Double-submit CSRF cookie
│   │   │       ├── jobs/         Scheduled workers: purge, alerts
│   │   │       ├── me/           Current account, export, delete
│   │   │       ├── notes/        Notes, drafts, versions, share, lease
│   │   │       ├── public/       Public JSON read by share token
│   │   │       ├── reports/      Report a note, appeal a takedown
│   │   │       └── tokens/       Personal API tokens
│   │   ├── dashboard/            Note list, open, rename, delete
│   │   ├── n/[token]/            Public read page (share host, raw HTML, no scripts)
│   │   ├── notes/[id]/           Markdown editor and version history
│   │   ├── oauth/consent/        OAuth consent screen
│   │   ├── report/               Report a note from a share link
│   │   ├── settings/             Account settings and token management
│   │   ├── signin/               Sign-in
│   │   └── status/               Status page
│   ├── core/                     Domain services, framework-free (no Next.js or MCP imports)
│   ├── db/                       Drizzle client and schema
│   │   └── schema/               users, notes, sharing, tokens, safety, authjs
│   ├── lib/                      Framework glue: session, CSRF, HTTP, markdown, metrics
│   ├── components/               Shared React components
│   ├── types/                    Ambient type declarations
│   ├── auth.ts                   Auth.js config and the dev-login gate
│   ├── env.ts                    Typed environment config (zod)
│   └── proxy.ts                  Content domain isolation (ADR-0007)
├── tests/                        Vitest suites, plus tests/helpers
├── drizzle/                      Generated SQL migrations and snapshots
├── docs/                         Design docs and ADRs, the single source of truth
│   └── decisions/                Architecture decision records (0001-0012)
├── runbooks/                     Incident response, breach, takedown, secrets rotation
├── scripts/                      load-test.mjs
├── public/                       Static assets
├── .github/                      CI workflow and Dependabot
├── AGENTS.md                     Rules for agents working in this repo
├── TRACKING.md                   Per-issue status across all phases
├── LAUNCH_CHECKLIST.md           Launch gate checklist
└── SECURITY.md                   Security disclosure policy
```

Two boundaries are worth calling out:

- **`src/core` is framework-free.** It holds the domain services (notes,
  versions, leases, sharing, moderation, OAuth) with no Next.js or MCP imports,
  so it can be extracted later. ESLint fails a build that imports `next/headers`
  from `src/core`.
- **`src/app/api/mcp` is a thin adapter.** The 12-tool surface lives in
  `src/core/mcp.ts`; the route only handles transport and auth.

## Stack

| Concern          | Choice                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| App              | Next.js (App Router, TypeScript)                                                    |
| Domain           | `src/core`, framework-free                                                          |
| Database         | Postgres via Drizzle ORM, migrations in `drizzle/`                                  |
| Human auth       | Auth.js (Google, GitHub)                                                            |
| Agent auth       | Own OAuth 2.1 server (PKCE, dynamic client registration) plus `mn_` personal tokens |
| Cache and limits | Managed Redis                                                                       |
| Jobs             | Scheduled worker for expiry, moderation, and notifications                          |
| Markdown         | `marked` for rendering, `sanitize-html` for the allowlist                           |
| Tests            | Vitest                                                                              |

## Getting started

Prerequisites: Node.js (LTS) and Docker (or any Postgres 16 instance).

```bash
# 1. Install dependencies
npm install

# 2. Configure the environment
cp .env.example .env.local
# Set APP_URL, SHARE_DOMAIN, DATABASE_URL, and AUTH_SECRET.
# For local development:
#   APP_URL=http://localhost:3000
#   SHARE_DOMAIN=http://localhost:3000
#   ENABLE_DEV_LOGIN=true

# 3. Start Postgres
docker run -d --name mn-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=memorynotes postgres:16
# DATABASE_URL=postgresql://postgres:postgres@localhost:5433/memorynotes

# 4. Apply migrations
npm run db:migrate

# 5. Run the dev server
npm run dev
```

Open <http://localhost:3000>. With `ENABLE_DEV_LOGIN=true` you can sign in
without provider credentials; that path is refused whenever
`NODE_ENV=production`.

### Commands

| Command                                   | Purpose                      |
| ----------------------------------------- | ---------------------------- |
| `npm run dev`                             | Start the dev server         |
| `npm run build` / `npm run start`         | Production build and serve   |
| `npm run lint` / `npm run lint:fix`       | ESLint                       |
| `npm run typecheck`                       | `tsc --noEmit`               |
| `npm run format` / `npm run format:check` | Prettier                     |
| `npm test` / `npm run test:watch`         | Vitest                       |
| `npm run db:generate`                     | Generate a Drizzle migration |
| `npm run db:migrate`                      | Apply migrations             |
| `npm run db:studio`                       | Drizzle Studio               |
| `npm run load:test`                       | Load and DoS test tooling    |

### Connecting an agent

Point any MCP client at `http://localhost:3000/api/mcp`. The server advertises
OAuth discovery at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`, and supports dynamic client
registration, so a client only needs the URL. Personal `mn_` API tokens work as
a bearer fallback. The tool surface is documented in
[`docs/09-api-and-mcp.md`](docs/09-api-and-mcp.md).

## Documentation

[`docs/`](docs/README.md) is the single source of truth for what we are building
and why. Code follows docs: if code needs to deviate, the doc changes first.
Start with [`docs/00-vision-and-scope.md`](docs/00-vision-and-scope.md) and
[`docs/02-architecture.md`](docs/02-architecture.md); decisions that are hard to
reverse, or that other docs depend on, are recorded in
[`docs/decisions/`](docs/decisions).

[`TRACKING.md`](TRACKING.md) is the status view: every tracked issue, its state,
and its commit.
