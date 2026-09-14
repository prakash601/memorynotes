import type { Metadata } from "next";
import Link from "next/link";
import { API_SCOPES, listApiTokens } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";
import { TokenManager } from "./token-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "API tokens" };

export default async function TokensPage() {
  const user = await requireUserOrRedirect();
  const tokens = await listApiTokens(getDb(), user.id);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">API tokens</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Tokens authorize the HTTP API with <code>Authorization: Bearer &lt;token&gt;</code>. The
            raw value is shown once and cannot be retrieved again.{" "}
            <Link href="/settings" className="underline">
              Back to settings
            </Link>
          </p>
        </div>

        <TokenManager
          allScopes={[...API_SCOPES]}
          tokens={tokens.map((token) => ({
            id: token.id,
            name: token.name,
            prefix: token.tokenPrefix,
            scopes: token.scopes,
            createdAt: token.createdAt.toISOString(),
            lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
            expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
          }))}
        />
      </div>
    </main>
  );
}
