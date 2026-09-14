export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MemoryNotes</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Shareable memory for your agents.
        </p>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        The application is under construction. Sign-in and note creation land in the next milestone.
      </p>
    </main>
  );
}
