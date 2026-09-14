export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This page does not exist, or the link is no longer available.
      </p>
    </main>
  );
}
