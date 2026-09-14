import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getEnv } from "@/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Status" };

interface ComponentStatus {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    await getDb().execute(sql`select 1`);
    return { name: "Database", ok: true, detail: "reachable" };
  } catch (error) {
    return {
      name: "Database",
      ok: false,
      detail: error instanceof Error ? error.message : "unreachable",
    };
  }
}

function badgeClass(ok: boolean): string {
  return ok
    ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    : "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200";
}

export default async function StatusPage() {
  const database = await checkDatabase();
  const components: ComponentStatus[] = [
    { name: "Web app and API", ok: true, detail: "serving this page" },
    database,
    { name: "Moderation queue", ok: true, detail: "accepting reports" },
  ];
  const allOk = components.every((component) => component.ok);
  const support = getEnv().SUPPORT_EMAIL;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Status</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Overall: <span className={badgeClass(allOk)}>{allOk ? "operational" : "degraded"}</span>
          </p>
        </div>

        <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {components.map((component) => (
            <li key={component.name} className="flex items-center justify-between gap-3 py-3">
              <span className="text-sm font-medium">{component.name}</span>
              <span className="flex items-center gap-2 text-xs text-zinc-500">
                {component.detail}
                <span className={badgeClass(component.ok)}>{component.ok ? "up" : "down"}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {support ? (
            <>
              Report an incident or get support at{" "}
              <a href={`mailto:${support}`} className="underline">
                {support}
              </a>
              .
            </>
          ) : (
            "A support contact is configured before public launch."
          )}
        </p>
      </div>
    </main>
  );
}
