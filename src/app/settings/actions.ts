"use server";

import { redirect } from "next/navigation";
import { deleteAccount } from "@/core";
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
