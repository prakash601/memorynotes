import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { auth, devLoginEnabled } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { UnauthorizedError } from "@/core";

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

/** Cookie set by the development-only `/api/dev-login` route. */
export const DEV_USER_COOKIE = "mn_dev_user";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (session?.user?.id) {
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    };
  }

  // Development-only fallback so the authenticated flows are testable without
  // real OAuth provider credentials. Refused in production by devLoginEnabled.
  if (devLoginEnabled()) {
    const store = await cookies();
    const email = store.get(DEV_USER_COOKIE)?.value?.trim().toLowerCase();
    if (email) {
      const [user] = await getDb()
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      if (user) {
        return { id: user.id, email: user.email, name: user.name };
      }
    }
  }

  return null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

/** For session-only operations (account and token management). */
export async function requireSessionUser(): Promise<SessionUser> {
  return requireUser();
}
