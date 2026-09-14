import type { ReactNode } from "react";

/** Shared shell for the published policy pages. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <article className="flex flex-col gap-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-zinc-900 dark:[&_h1]:text-zinc-100 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100 [&_li]:ml-5 [&_li]:list-disc [&_p]:m-0 [&_strong]:font-medium">
        {children}
      </article>
    </main>
  );
}
