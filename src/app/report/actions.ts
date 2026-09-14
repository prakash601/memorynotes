"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { REPORT_REASONS, createReport, isDomainError } from "@/core";
import { getDb } from "@/db";
import { limit } from "@/lib/rate-limit";
import { hashIp } from "@/lib/request";
import { getCurrentUser } from "@/lib/session";

function reportPath(token: string): string {
  return `/report?token=${encodeURIComponent(token)}`;
}

/**
 * Public report intake (A7). A server action so the read page's strict CSP can
 * stay free of scripts; Next's server actions provide CSRF protection.
 */
export async function submitReportAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();

  if (!token) {
    redirect(`/report?error=missing`);
  }
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    redirect(`${reportPath(token)}&error=reason`);
  }

  let errorCode: string | null = null;
  try {
    const headerList = await headers();
    const ip =
      (headerList.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      headerList.get("x-real-ip") ||
      "unknown";
    await limit("report_ip_hour", hashIp(ip));
    const viewer = await getCurrentUser();

    await createReport(getDb(), {
      shareToken: token,
      reason,
      details: details || null,
      reporterUserId: viewer?.id ?? null,
      reporterIpHash: hashIp(ip),
    });
  } catch (error) {
    errorCode = isDomainError(error) ? error.code : "error";
  }

  if (errorCode) {
    redirect(`${reportPath(token)}&error=${encodeURIComponent(errorCode)}`);
  }
  redirect(`${reportPath(token)}&submitted=1`);
}
