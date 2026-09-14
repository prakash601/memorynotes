import type { Metadata } from "next";

export const metadata: Metadata = { title: "Acceptable Use Policy" };

export default function AupPage() {
  return (
    <>
      <h1>Acceptable Use Policy</h1>
      <p>Last updated: 2026-09-14</p>

      <p>
        MemoryNotes hosts user content on a separate share domain. This policy applies to everything
        you create, publish, or share through the service.
      </p>

      <h2>Refused categories</h2>
      <ul>
        <li>Adult content involving minors, in any form. This is zero tolerance.</li>
        <li>Sexually explicit content.</li>
        <li>Malware, phishing, or content designed to deceive.</li>
        <li>Doxxing, harassment, and threats.</li>
        <li>Impersonation of people or organizations.</li>
        <li>Spam and SEO manipulation.</li>
        <li>Content that infringes copyright or other rights.</li>
      </ul>

      <h2>Child safety</h2>
      <p>
        We do not permit child sexual abuse material. Content is checked against known-materials
        hashes on every create, edit, and publish. Confirmed material is removed, the account is
        banned, and we report to the appropriate authority, including the National Center for
        Missing &amp; Exploited Children (NCMEC) and, where applicable, the Internet Watch
        Foundation (IWF). To report child safety content, use the report button on any note or email
        our safety contact.
      </p>

      <h2>Enforcement</h2>
      <p>
        We review reports within 24 to 48 hours on a best-effort basis. Content can be taken down
        after review; the owner is notified and can appeal. Repeated abuse leads to a ban, and
        banning an account darkens all of its notes.
      </p>

      <h2>Rate limits</h2>
      <p>
        Creation, publishing, API calls, and reads are rate limited. Attempts to evade limits,
        scrape, or bulk-create are a violation of this policy.
      </p>
    </>
  );
}
