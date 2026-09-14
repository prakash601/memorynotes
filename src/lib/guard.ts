import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "./session";

/** For server components and server actions: bounce anonymous callers to sign-in. */
export async function requireUserOrRedirect(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/signin");
  }
  return user;
}
