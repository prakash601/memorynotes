import { auth } from "@/auth";
import { UnauthorizedError } from "@/core";

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return null;
  }
  return {
    id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };
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
