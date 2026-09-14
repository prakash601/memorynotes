import type { Metadata } from "next";

export const metadata: Metadata = { title: "Subprocessors" };

const rows: Array<{ name: string; purpose: string; location: string }> = [
  { name: "Supabase", purpose: "Postgres database", location: "EU/US region as configured" },
  {
    name: "Application host",
    purpose: "Compute and CDN for both domains",
    location: "As configured",
  },
  { name: "Redis", purpose: "Rate-limit counters and idempotency keys", location: "As configured" },
  {
    name: "Moderation provider",
    purpose: "Text moderation and known-materials hash matching",
    location: "Selected before launch",
  },
  {
    name: "Email provider",
    purpose: "Transactional and safety notifications",
    location: "Selected before launch",
  },
  {
    name: "Error tracker",
    purpose: "Error and performance monitoring",
    location: "Selected before launch",
  },
];

export default function SubprocessorsPage() {
  return (
    <>
      <h1>Subprocessors</h1>
      <p>Last updated: 2026-09-14</p>
      <p>
        These providers process data on our behalf under data-processing agreements. We list the
        category and purpose even where the vendor is not yet selected; we publish the name before
        the related capability goes live.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
              <th className="py-2 pr-4 font-medium">Provider</th>
              <th className="py-2 pr-4 font-medium">Purpose</th>
              <th className="py-2 font-medium">Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-zinc-200 dark:border-zinc-800">
                <td className="py-2 pr-4">{row.name}</td>
                <td className="py-2 pr-4">{row.purpose}</td>
                <td className="py-2">{row.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
