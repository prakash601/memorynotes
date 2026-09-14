# Runbook: content takedown

Covers the report queue, takedown, owner notification, appeal, and the CSAM
path (doc 06, A3/A7/A8, launch gate 2).

## SLA

- Acknowledge: 24 hours.
- Resolve: 48 hours.
  Best effort, stated in the Acceptable Use Policy.

## Triage

1. Open `/admin/reports` (moderator access via `ADMIN_EMAILS`).
2. Read the report reason and details; open the note if it still resolves.
3. Decide: **Takedown**, **Resolve** (no action), or **Dismiss** (not a
   violation).

## Takedown

1. Click **Takedown**. This soft-deletes the note, revokes its link, marks the
   report `actioned`, and notifies the owner.
2. The content stays recoverable for the 30-day soft-delete window, which is
   what makes an appeal reviewable.
3. If the content is child sexual abuse material:
   - Do not re-open or download the material beyond what is required.
   - Preserve the report row and the moderation event as evidence.
   - File with NCMEC (and IWF where applicable) per the AUP.
   - Ban the account and notify the safety contact.
4. Record the outcome in the report's resolution note.

## Appeal

1. The owner appeals from their side; the report returns to `reviewing`.
2. Re-review with the original reason and the appeal message.
3. If the appeal is upheld, restore the note (clear `notes.deleted_at` and
   re-create the share) and mark the report `dismissed` with a note. There is
   no restore button yet; this is a manual SQL step:
   ```sql
   update notes set deleted_at = null, updated_at = now() where id = '<note-id>';
   ```
   Then issue a fresh link from the dashboard.
4. If the appeal is denied, mark the report `actioned` again and reply.

## Account ban

- `update users set status = 'banned' where id = '<user-id>';`
- Banning darkens all of the account's notes. The appeal path for a banned
  account is the same as above.

## Rehearsal

Rehearse once before launch: run a synthetic report through triage, takedown,
notification, and appeal against staging, and record the timings here.

- Last rehearsed: not yet.
