import { NextResponse } from "next/server";
import {
  ForbiddenError,
  ValidationError,
  getReport,
  takedownReport,
  updateReportStatus,
} from "@/core";
import { getDb } from "@/db";
import { isAdmin } from "@/lib/admin";
import { assertCsrf, problemResponse, readJsonBody } from "@/lib/http";
import { serializeReport } from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface PatchReportBody {
  status?: string;
  resolution_note?: string;
  action?: "takedown";
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    if (!isAdmin(user.email)) {
      throw new ForbiddenError("Moderator access required");
    }
    const { id } = await context.params;
    return NextResponse.json({ report: serializeReport(await getReport(getDb(), id)) });
  } catch (error) {
    return problemResponse(error);
  }
}

/** Resolve a report, or action a takedown (A8). Moderators only. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    if (!isAdmin(user.email)) {
      throw new ForbiddenError("Moderator access required");
    }
    assertCsrf(request);
    const { id } = await context.params;
    const body = await readJsonBody<PatchReportBody>(request);
    const db = getDb();

    if (body.action === "takedown") {
      const { report } = await takedownReport(db, {
        reportId: id,
        moderatorId: user.id,
        resolutionNote: body.resolution_note ?? null,
      });
      return NextResponse.json({ report: serializeReport(report) });
    }

    if (!body.status) {
      throw new ValidationError("Provide a status or action");
    }

    const report = await updateReportStatus(db, {
      reportId: id,
      status: body.status,
      resolutionNote: body.resolution_note ?? null,
    });
    return NextResponse.json({ report: serializeReport(report) });
  } catch (error) {
    return problemResponse(error);
  }
}
