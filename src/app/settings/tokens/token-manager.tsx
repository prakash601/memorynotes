"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createTokenAction, revokeTokenAction } from "./actions";

interface TokenItem {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface TokenManagerProps {
  allScopes: string[];
  tokens: TokenItem[];
}

const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const primaryButtonClass =
  "h-9 shrink-0 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const smallButtonClass =
  "h-8 shrink-0 rounded-md border border-zinc-300 px-3 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

export function TokenManager({ allScopes, tokens }: TokenManagerProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(allScopes);
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  }

  async function handleCreate() {
    setBusy(true);
    setMessage(null);
    const result = await createTokenAction({ name, scopes });
    setBusy(false);

    if (result.ok) {
      setSecret(result.secret ?? null);
      setName("");
      router.refresh();
      return;
    }
    setMessage(result.message ?? "Could not create token");
  }

  async function handleRevoke(tokenId: string) {
    setBusy(true);
    setMessage(null);
    const result = await revokeTokenAction({ tokenId });
    setBusy(false);

    if (result.ok) {
      router.refresh();
      return;
    }
    setMessage(result.message ?? "Could not revoke token");
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 border-y border-zinc-200 py-5 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Create a token</h2>
        <label className="sr-only" htmlFor="token-name">
          Token name
        </label>
        <input
          id="token-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Token name, e.g. CLI"
          className={inputClass}
        />
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">Scopes</legend>
          {allScopes.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              <code className="text-xs">{scope}</code>
            </label>
          ))}
        </fieldset>
        <div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim() || scopes.length === 0}
            className={primaryButtonClass}
          >
            Create token
          </button>
        </div>

        {secret ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950">
            <p className="text-xs font-medium text-emerald-900 dark:text-emerald-200">
              Copy this now. It is shown once.
            </p>
            <p className="mt-1 break-all font-mono text-xs text-emerald-900 dark:text-emerald-200">
              {secret}
            </p>
          </div>
        ) : null}
        {message ? <p className="text-sm text-red-600 dark:text-red-400">{message}</p> : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Active tokens</h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-zinc-500">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {tokens.map((token) => (
              <li key={token.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <p className="font-mono text-xs text-zinc-500">{token.prefix}…</p>
                  <p className="text-xs text-zinc-500">{token.scopes.join(", ")}</p>
                  <p className="text-xs text-zinc-500">
                    {token.lastUsedAt ? `last used ${token.lastUsedAt.slice(0, 10)}` : "never used"}
                    {token.expiresAt ? ` · expires ${token.expiresAt.slice(0, 10)}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(token.id)}
                  disabled={busy}
                  className={smallButtonClass}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
