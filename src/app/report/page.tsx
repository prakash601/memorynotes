import type { Metadata } from "next";
import { REPORT_REASONS, REPORT_SLA_HOURS } from "@/core";
import { submitReportAction } from "./actions";

export const metadata: Metadata = { title: "Report a note" };

const selectClass =
  "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const textareaClass =
  "w-full rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const buttonClass =
  "h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "This report link is missing its note token.",
  reason: "Choose a reason for the report.",
  not_found: "That link does not exist.",
  rate_limited: "Too many reports from this connection. Try again later.",
  error: "Something went wrong. Please try again.",
};

type PageProps = {
  searchParams: Promise<{ token?: string; submitted?: string; error?: string }>;
};

export default async function ReportPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = params.token ?? "";
  const submitted = params.submitted === "1";
  const error = params.error;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">Report a note</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Reports go to a moderation queue reviewed within {REPORT_SLA_HOURS.acknowledge} to{" "}
        {REPORT_SLA_HOURS.resolve} hours, best effort. Abuse of this form is rate limited.
      </p>

      {submitted ? (
        <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Thanks. Your report is in the queue.
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.error}
        </div>
      ) : null}

      <form action={submitReportAction} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <div className="flex flex-col gap-1">
          <label htmlFor="reason" className="text-sm font-medium">
            Reason
          </label>
          <select id="reason" name="reason" required className={selectClass} defaultValue="">
            <option value="" disabled>
              Select a reason
            </option>
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="details" className="text-sm font-medium">
            Details (optional)
          </label>
          <textarea id="details" name="details" rows={5} className={textareaClass} />
        </div>
        <button type="submit" className={buttonClass} disabled={!token}>
          Submit report
        </button>
      </form>
    </main>
  );
}
