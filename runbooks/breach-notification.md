# Runbook: breach notification

Covers a personal-data breach (doc 07, P8). GDPR-style duties apply to everyone
we serve, not only EU users.

## Define a breach

Any confirmed or suspected loss of confidentiality, integrity, or availability
of personal data. Examples: a leaked database credential, a session or token
compromise at scale, or an unintended public exposure of private notes.

## Steps

1. **Detect and record.** Note the time of discovery, the reporter, and the
   systems involved. Open an incident (see `incident-response.md`).
2. **Contain.** Rotate the affected secrets (see `secrets-rotation.md`), revoke
   sessions and tokens, and disable the affected surface. Prefer containment
   over preserving the attack path.
3. **Assess.** Determine what data, whose data, how many people, and the risk to
   them. Personal data here is: email, provider identity, note content, and
   hashed IPs.
4. **Notify the authority.** If the breach is likely to result in a risk to
   people, notify the supervisory authority within 72 hours of awareness.
5. **Notify affected users.** Without undue delay if there is a high risk.
   Explain what happened, what data, what we did, and what they should do.
6. **Document.** Keep the facts, the assessment, the decisions, and the
   notifications. This record is required even when a notification is not.
7. **Post-mortem.** Write the cause and the fix. Track the actions to done.

## Where to look

- Application and export data: the `notes`, `note_versions`, `users`, and
  `activity_log` tables.
- Access: `sessions`, `api_tokens`, `oauth_tokens`, `oauth_consents`.
- Operational logs: structured JSON from `src/lib/logger.ts` (30-day window).

## Rehearsal

Rehearse once before launch: run a tabletop where a database credential leaks,
and produce the notification text within the 72-hour clock.

- Last rehearsed: not yet.
