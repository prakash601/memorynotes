import type { Metadata } from "next";
import { signInWithProvider } from "@/auth";

export const metadata: Metadata = {
  title: "Sign in",
};

async function signInWithGoogle() {
  "use server";
  await signInWithProvider("google");
}

async function signInWithGitHub() {
  "use server";
  await signInWithProvider("github");
}

const buttonClass =
  "flex h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

export default function SignInPage() {
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
          <button type="submit" className={buttonClass}>
            Continue with Google
          </button>
        </form>
        <form action={signInWithGitHub}>
          <button type="submit" className={buttonClass}>
            Continue with GitHub
          </button>
        </form>
      </div>
    </main>
  );
}
