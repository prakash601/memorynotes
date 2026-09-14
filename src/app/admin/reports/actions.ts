"use server";

import { revalidatePath } from "next/cache";
import { takedownReport, updateReportStatus } from "@/core";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin";
import { requireUserOrRedirect } from "@/lib/guard";

async function requireModerator() {
  const user = await requireUserOrRedirect();
  if (!isAdmin(user.email)) {
    throw new Error("Moderator access required");
  }
  return user;
}

export async function takedownAction(formData: FormData): Promise<void> {
  const user = await requireModerator();
  await takedownReport(getDb(), {
    reportId: String(formData.get("reportId") ?? ""),
    moderatorId: user.id,
    resolutionNote: String(formData.get("resolutionNote") ?? "") || null,
  });
  revalidatePath("/admin/reports");
}

export async function resolveAction(formData: FormData): Promise<void> {
  await requireModerator();
  await updateReportStatus(getDb(), {
    reportId: String(formData.get("reportId") ?? ""),
    status: "actioned",
    resolutionNote: String(formData.get("resolutionNote") ?? "") || "Reviewed, no action taken",
  });
  revalidatePath("/admin/reports");
}

export async function dismissAction(formData: FormData): Promise<void> {
  await requireModerator();
  await updateReportStatus(getDb(), {
    reportId: String(formData.get("reportId") ?? ""),
    status: "dismissed",
    resolutionNote: String(formData.get("resolutionNote") ?? "") || "Dismissed",
  });
  revalidatePath("/admin/reports");
}
