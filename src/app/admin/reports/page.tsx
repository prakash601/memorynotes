import { notFound } from "next/navigation";
import { listReports } from "@/core";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin";
import { requireUserOrRedirect } from "@/lib/guard";
import { dismissAction, resolveAction, takedownAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Moderation queue" };

const FILTERS = ["open", "reviewing", "actioned", "dismissed"] as const;

const smallButtonClass =
  "h-8 shrink-0 rounded-md border border-zinc-300 px-3 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const dangerButtonClass =
  "h-8 shrink-0 rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-500";

type PageProps = { searchParams: Promise<{ status?: string }> };

export default async function ModerationQueuePage({ searchParams }: PageProps) {
  const user = await requireUserOrRedirect();
  if (!isAdmin(user.email)) {
    notFound();
  }

  const params = await searchParams;
  const status = FILTERS.includes(params.status as (typeof FILTERS)[number])
    ? (params.status as (typeof FILTERS)[number])
    : undefined;
  const reports = await listReports(getDb(), { status, limit: 100 });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold">Moderation queue</h1>
          <span className="text-sm text-zinc-500">
            {reports.length} {reports.length === 1 ? "report" : "reports"}
          </span>
        </div>

        <nav className="flex flex-wrap gap-2 text-sm">
          <a href="/admin/reports" className="underline">
            All
          </a>
          {FILTERS.map((filter) => (
            <a key={filter} href={`/admin/reports?status=${filter}`} className="underline">
              {filter}
            </a>
          ))}
        </nav>

        {reports.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing in the queue.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-col gap-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {report.reason} · {report.status}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-zinc-500">
                      note {report.noteId ?? "purged"} · report {report.id.slice(0, 8)}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-zinc-500">
                    {report.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </time>
                </div>

                {report.details ? (
                  <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                    {report.details}
                  </p>
                ) : null}

                {report.resolutionNote ? (
                  <p className="text-xs text-zinc-500">Resolution: {report.resolutionNote}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {report.status === "open" || report.status === "reviewing" ? (
                    <>
                      <form action={takedownAction}>
                        <input type="hidden" name="reportId" value={report.id} />
                        <button type="submit" className={dangerButtonClass}>
                          Takedown
                        </button>
                      </form>
                      <form action={resolveAction}>
                        <input type="hidden" name="reportId" value={report.id} />
                        <button type="submit" className={smallButtonClass}>
                          Resolve
                        </button>
                      </form>
                      <form action={dismissAction}>
                        <input type="hidden" name="reportId" value={report.id} />
                        <button type="submit" className={smallButtonClass}>
                          Dismiss
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
