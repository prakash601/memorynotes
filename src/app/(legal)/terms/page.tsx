import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Last updated: 2026-09-14</p>

      <p>
        These terms govern your use of MemoryNotes. By creating an account you agree to them and to
        the Acceptable Use Policy.
      </p>

      <h2>The service</h2>
      <p>
        MemoryNotes lets you write notes, publish immutable versions, and share them by link with or
        without an account. Editing requires signing in.
      </p>

      <h2>Your content</h2>
      <p>
        You keep ownership of your content. You grant us the limited license needed to store,
        render, and serve it, including to anyone holding a share link, so the product can function.
        You are responsible for what you create and share.
      </p>

      <h2>Accounts</h2>
      <p>
        You must be at least 13 years old, or 16 in the EU. You are responsible for activity under
        your account. We may suspend or remove content or accounts that violate the Acceptable Use
        Policy.
      </p>

      <h2>Availability and liability</h2>
      <p>
        The service is provided as is, without warranties. To the extent permitted by law, we are
        not liable for indirect or consequential damages. Links expire and content can be removed;
        keep your own copies using export.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. Material changes will be announced in the product before they
        take effect.
      </p>
    </>
  );
}
