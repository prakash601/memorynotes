import type { Metadata } from "next";
import { devLoginEnabled, signInWithProvider } from "@/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

/** Only same-origin relative paths are accepted, so `next` cannot be an open redirect. */
function safeNext(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/";
}

async function signInWithGoogle(formData: FormData) {
  "use server";
  await signInWithProvider("google", safeNext(String(formData.get("next") ?? "/")));
}

async function signInWithGitHub(formData: FormData) {
  "use server";
  await signInWithProvider("github", safeNext(String(formData.get("next") ?? "/")));
}

const buttonClass =
  "flex h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

type PageProps = { searchParams: Promise<{ next?: string }> };

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNext(params.next ?? "/");
  const showDev = devLoginEnabled();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Continue with Google or GitHub to create and share MemoryNotes.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <button type="submit" className={buttonClass}>
            Continue with Google
          </button>
        </form>
        <form action={signInWithGitHub}>
          <input type="hidden" name="next" value={next} />
          <button type="submit" className={buttonClass}>
            Continue with GitHub
          </button>
        </form>
      </div>

      {showDev ? (
        <form
          method="get"
          action="/api/dev-login"
          className="flex flex-col gap-2 rounded-md border border-dashed border-amber-400 p-4 dark:border-amber-700"
        >
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
            Dev sign-in (local only, never enabled in production)
          </p>
          <input type="hidden" name="next" value={next} />
          <label className="sr-only" htmlFor="dev-email">
            Email
          </label>
          <input
            id="dev-email"
            name="email"
            type="email"
            defaultValue="demo@local.test"
            placeholder="you@example.test"
            className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button type="submit" className={buttonClass}>
            Sign in as this email
          </button>
        </form>
      ) : null}
    </main>
  );
}
