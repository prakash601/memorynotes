import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

/**
 * A local-only escape hatch for development. When `ENABLE_DEV_LOGIN=true` and
 * `NODE_ENV` is not production, `getCurrentUser` also accepts the `mn_dev_user`
 * cookie set by `/api/dev-login`. It is never active in production and does not
 * touch the real session model.
 */
export function devLoginEnabled(): boolean {
  return process.env.ENABLE_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";
}

let instance: ReturnType<typeof NextAuth> | undefined;

/**
 * Built lazily so importing this module never requires configuration or a
 * database. Keeps `next build` working without secrets present.
 *
 * Database sessions (not JWT) so a session can be revoked server-side (S8).
 */
export function getAuth(): ReturnType<typeof NextAuth> {
  if (!instance) {
    instance = NextAuth({
      adapter: DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      }),
      session: { strategy: "database" },
      providers: [Google, GitHub],
      pages: { signIn: "/signin" },
      trustHost: true,
      callbacks: {
        session({ session, user }) {
          // Database sessions carry the account row; expose its id to callers.
          if (user) {
            session.user.id = user.id;
          }
          return session;
        },
      },
    });
  }
  return instance;
}

export async function auth() {
  return getAuth().auth();
}

export async function signInWithProvider(provider: "google" | "github", redirectTo = "/") {
  await getAuth().signIn(provider, { redirectTo });
}

export async function signOutCurrent() {
  await getAuth().signOut({ redirectTo: "/" });
}
