import { getEnv } from "@/env";

/** Moderators allowed into the triage queue. */
export function adminEmails(): string[] {
  return (getEnv().ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return adminEmails().includes(email.toLowerCase());
}
