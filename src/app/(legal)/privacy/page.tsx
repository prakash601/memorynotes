import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated: 2026-09-14</p>

      <h2>What we collect</h2>
      <ul>
        <li>Account: email, auth provider, display name, and timestamps.</li>
        <li>Content: note text, both draft and published versions, and metadata.</li>
        <li>
          Operational: hashed IP addresses, user agent, logs for 30 days, and rate-limit counters.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        To run the service, keep it safe, and meet legal obligations. We do not sell data and we do
        not use ad technology. Analytics are cookieless and privacy-friendly.
      </p>

      <h2>Retention</h2>
      <ul>
        <li>Deleted notes are soft-deleted for 30 days, then content and versions are purged.</li>
        <li>Expired links show a clean gone page; the note survives for the owner.</li>
        <li>Operational logs are kept for 30 days.</li>
        <li>Deleted data may remain in backups for a bounded 30-day window.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can export everything you have as JSON plus markdown, and delete your account, from
        settings. Deletion purges content and versions. We build to GDPR-style rights for everyone.
      </p>

      <h2>AI disclosure</h2>
      <p>
        Content may be sent to the AI provider you connect, and notes may be authored by an AI. Tool
        output treats note content as untrusted data, never as instructions.
      </p>

      <h2>Children</h2>
      <p>
        The service is not for children. The minimum age is 13, or 16 for users in the EU. We do not
        run a dedicated children&apos;s service.
      </p>

      <h2>Transfers</h2>
      <p>
        We rely on our providers&apos; standard contractual clauses for international transfers, and
        we list our subprocessors separately.
      </p>
    </>
  );
}
