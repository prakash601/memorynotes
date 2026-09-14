import type { Metadata } from "next";
import { validateAuthorizationRequest } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";
import { approveConsentAction, denyConsentAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Authorize app" };

const authorizeButtonClass =
  "h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const denyButtonClass =
  "h-10 rounded-md border border-zinc-300 px-4 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

const PARAM_KEYS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
] as const;

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ConsentPage({ searchParams }: PageProps) {
  await requireUserOrRedirect();
  const params = await searchParams;

  const search = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const value = params[key];
    if (typeof value === "string") {
      search.set(key, value);
    }
  }

  const validation = await validateAuthorizationRequest(getDb(), search);

  if (!validation.ok) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-16">
        <h1 className="text-xl font-semibold">Authorization error</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{validation.description}</p>
      </main>
    );
  }

  const { client, scopes } = validation.request;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Authorize {client.clientName}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="font-medium">{client.clientName}</span> is requesting access to your
        MemoryNotes account. It will be able to:
      </p>

      <ul className="mt-4 flex flex-col gap-1 text-sm">
        {scopes.map((scope) => (
          <li key={scope} className="flex items-center gap-2">
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
              {scope}
            </code>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex gap-3">
        <form action={approveConsentAction}>
          {PARAM_KEYS.map((key) =>
            search.get(key) ? (
              <input key={key} type="hidden" name={key} value={search.get(key) ?? ""} />
            ) : null,
          )}
          <button type="submit" className={authorizeButtonClass}>
            Allow
          </button>
        </form>
        <form action={denyConsentAction}>
          {PARAM_KEYS.map((key) =>
            search.get(key) ? (
              <input key={key} type="hidden" name={key} value={search.get(key) ?? ""} />
            ) : null,
          )}
          <button type="submit" className={denyButtonClass}>
            Deny
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs text-zinc-500">
        You can revoke this access at any time from settings; revocation takes effect immediately.
      </p>
    </main>
  );
}
