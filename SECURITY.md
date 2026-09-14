# Security Policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately to the
support contact published on the status page, or by email to the address in
`SUPPORT_EMAIL`. Include reproduction steps and the affected version.

We aim to acknowledge within 48 hours and to give a remediation timeline after
triage.

## Scope

- The web app, HTTP API, MCP endpoint, and OAuth 2.1 authorization server.
- Auth: sessions, personal API tokens, OAuth access and refresh tokens.
- Content handling: markdown rendering and the public read page.
- Abuse controls: moderation, reporting, and rate limits.

## Out of scope

- Denial of service that only degrades a single unauthenticated test request.
- Missing headers on non-content assets.
- Findings that require a compromised browser or a malicious extension.

## Practices in this repository

- Dependencies are audited (`npm audit --audit-level=high`) and scanned with
  CodeQL on every push and pull request; Dependabot keeps them current.
- Secrets load from the environment only; nothing secret is committed.
- Share tokens and API tokens are stored as hashes; share tokens are also
  encrypted so the owner can re-display a link, with key rotation supported.
- Content is sanitized with a strict allowlist and served with a strict CSP.
