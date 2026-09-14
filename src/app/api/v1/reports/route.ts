import { NextResponse } from "next/server";
import { createReport, listReports } from "@/core";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin";
import { applyRateLimitHeaders, problemResponse, readJsonBody } from "@/lib/http";
import { limit } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import { serializeReport } from "@/lib/serializers";
import { ForbiddenError } from "@/core";
import { getCurrentUser, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface CreateReportBody {
  share_token?: string;
  reason?: string;
  details?: string;
}

/**
 * Public report intake from the read page. Rate limited per hashed IP so the
 * queue cannot be flooded; the reporter may be anonymous.
 */
export async function POST(request: Request) {
  try {
    const ipHash = hashIp(clientIp(request));
    const state = await limit("report_ip_hour", ipHash);
    const body = await readJsonBody<CreateReportBody>(request);
    const viewer = await getCurrentUser();

    const report = await createReport(getDb(), {
      reason: body.reason ?? "",
      details: body.details ?? null,
      shareToken: body.share_token ?? null,
      reporterUserId: viewer?.id ?? null,
      reporterIpHash: ipHash,
    });

    return applyRateLimitHeaders(
      NextResponse.json({ report: serializeReport(report) }, { status: 201 }),
      state,
    );
  } catch (error) {
    return problemResponse(error);
  }
}

/** Triage queue. Moderators only. */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!isAdmin(user.email)) {
      throw new ForbiddenError("Moderator access required");
    }
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const items = await listReports(getDb(), { status });

    return NextResponse.json({ data: items.map(serializeReport), next_cursor: null });
  } catch (error) {
    return problemResponse(error);
  }
}
