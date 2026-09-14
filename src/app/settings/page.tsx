import Link from "next/link";
import { getAccount, listConsents } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";
import { deleteAccountAction, revokeAppAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const dangerButtonClass =
  "h-9 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500";

type PageProps = { searchParams: Promise<{ error?: string }> };

export default async function SettingsPage({ searchParams }: PageProps) {
  const user = await requireUserOrRedirect();
  const account = await getAccount(getDb(), user.id);
  const connectedApps = await listConsents(getDb(), user.id);
  const params = await searchParams;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <div className="flex flex-col gap-8">
        <h1 className="text-xl font-semibold">Settings</h1>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Account</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{account?.email}</p>
          <p className="text-sm text-zinc-500">
            Email verification:{" "}
            {account?.emailVerified ? (
              <span className="text-emerald-600 dark:text-emerald-400">verified</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                not verified — a verified email is required before a note can be public
              </span>
            )}
          </p>
        </section>

        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-medium">API tokens</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Create scoped tokens for scripts and agents. The raw value is shown once.
          </p>
          <div>
            <Link
              href="/settings/tokens"
              className="h-9 inline-flex items-center rounded-md border border-zinc-300 px-4 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Manage tokens
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-medium">Connected apps</h2>
          {connectedApps.length === 0 ? (
            <p className="text-sm text-zinc-500">No apps are connected.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {connectedApps.map((app) => (
                <li key={app.clientId} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{app.clientName}</p>
                    <p className="text-xs text-zinc-500">{app.scopes.join(", ")}</p>
                  </div>
                  <form action={revokeAppAction}>
                    <input type="hidden" name="clientId" value={app.clientId} />
                    <button
                      type="submit"
                      className="h-8 shrink-0 rounded-md border border-zinc-300 px-3 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-medium">Export your data</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Download every note with its draft, link, and full version history.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/v1/me/export?format=json"
              className="h-9 rounded-md border border-zinc-300 px-4 text-sm leading-9 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Download JSON
            </a>
            <a
              href="/api/v1/me/export?format=markdown"
              className="h-9 rounded-md border border-zinc-300 px-4 text-sm leading-9 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Download markdown
            </a>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-red-600 dark:text-red-400">Delete account</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This removes your content and versions. The account tombstone is purged after 30 days,
            and residual copies leave backups within 30 days.
          </p>
          {params.error === "confirm" ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              Type DELETE exactly to confirm.
            </p>
          ) : null}
          <form action={deleteAccountAction} className="flex items-center gap-2">
            <label className="sr-only" htmlFor="confirm">
              Type DELETE to confirm
            </label>
            <input
              id="confirm"
              name="confirm"
              placeholder="DELETE"
              className={`${inputClass} w-40`}
            />
            <button type="submit" className={dangerButtonClass}>
              Delete account
            </button>
          </form>
        </section>

        <section className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800">
          Policies:{" "}
          <Link href="/aup" className="underline">
            AUP
          </Link>
          ,{" "}
          <Link href="/terms" className="underline">
            Terms
          </Link>
          ,{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          ,{" "}
          <Link href="/subprocessors" className="underline">
            Subprocessors
          </Link>
        </section>
      </div>
    </main>
  );
}
