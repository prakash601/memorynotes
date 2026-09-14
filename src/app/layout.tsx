import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutCurrent } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "MemoryNotes",
    template: "%s · MemoryNotes",
  },
  description: "Shareable memory for your agents.",
};

async function signOutAction() {
  "use server";
  await signOutCurrent();
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-3">
            <Link href="/" className="text-sm font-semibold">
              MemoryNotes
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              {user ? (
                <>
                  <Link
                    href="/dashboard"
                    className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Notes
                  </Link>
                  <Link
                    href="/settings"
                    className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Settings
                  </Link>
                  <span className="hidden text-zinc-400 sm:inline">
                    {user.email ?? user.name ?? "Signed in"}
                  </span>
                  <form action={signOutAction}>
                    <button
                      type="submit"
                      className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <Link
                  href="/signin"
                  className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>
        {children}
        <footer className="mt-auto border-t border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-4 px-6 py-4 text-xs text-zinc-500">
            <Link href="/aup" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Acceptable Use
            </Link>
            <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Privacy
            </Link>
            <Link href="/subprocessors" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Subprocessors
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
