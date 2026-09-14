# Runbook: secrets rotation (S13)

Rotate on a schedule, on staff change, and immediately after any suspected
exposure. Never commit a secret; everything loads from the environment.

## Secrets

| Secret                                     | Effect of rotation                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                              | Invalidates sessions. Share-token encryption falls back to it when `SHARE_TOKEN_SECRETS` is unset. |
| `SHARE_TOKEN_SECRETS`                      | Rotation key for share-token display. Newest first.                                                |
| `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_SECRET` | OAuth sign-in until the provider secret is updated.                                                |
| `DATABASE_URL`                             | Connection credentials; rotate in the provider first.                                              |
| `CRON_SECRET`                              | The scheduled job endpoints stop until the scheduler is updated.                                   |

## Share-token keys (non-breaking)

`SHARE_TOKEN_SECRETS` is a comma-separated list, newest first. Encryption uses
the first key; decryption tries every key. To rotate:

1. Put the new secret first and keep the old one after it:
   `SHARE_TOKEN_SECRETS=<new>,<old>`
2. Deploy. New links encrypt with the new key; old links still resolve because
   lookup is by hash, and their display still decrypts with the old key.
3. Keep the old key for at least 90 days (the longest link lifetime).
4. Links set to `never` will lose display if the old key is dropped. Either
   accept that the dashboard shows "Link unavailable, rotate", or re-encrypt
   pasted links before dropping the key. Rotating a note's link is the escape
   hatch and never breaks the note.

## Auth secret

1. Generate a new value (`npx auth secret`).
2. Deploy. All sessions are invalidated; everyone signs in again.
3. If `SHARE_TOKEN_SECRETS` is set, `AUTH_SECRET` rotation does not affect
   share-token display.

## Verification

- After a share-key rotation, open an old link and confirm it still resolves and
  displays.
- After an `AUTH_SECRET` rotation, confirm sign-in works and old sessions are
  gone.

## Record

- Date, secret, reason, and rollback. Keep the log with the breach runbook when
  the rotation follows an incident.
