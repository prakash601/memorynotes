"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteAccount, revokeConsent } from "@/core";
import { getDb } from "@/db";
import { requireUserOrRedirect } from "@/lib/guard";

/**
 * Self-serve account delete (P5). Requires the literal confirmation phrase so a
 * stray click cannot destroy an account.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "DELETE") {
    redirect("/settings?error=confirm");
  }

  await deleteAccount(getDb(), user.id);
  redirect("/");
}

/** Revoke a connected app; this kills its tokens immediately. */
export async function revokeAppAction(formData: FormData): Promise<void> {
  const user = await requireUserOrRedirect();
  await revokeConsent(getDb(), {
    userId: user.id,
    clientId: String(formData.get("clientId") ?? ""),
  });
  revalidatePath("/settings");
}
