import { NextResponse } from "next/server";
import { ValidationError, appealReport } from "@/core";
import { getDb } from "@/db";
import { assertCsrf, problemResponse, readJsonBody } from "@/lib/http";
import { serializeReport } from "@/lib/serializers";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

interface AppealBody {
  message?: string;
}

/** The owner's appeal against a takedown (A8). */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    assertCsrf(request);
    const { id } = await context.params;
    const body = await readJsonBody<AppealBody>(request);
    const message = (body.message ?? "").trim();
    if (!message) {
      throw new ValidationError("An appeal needs a message");
    }

    const report = await appealReport(getDb(), {
      reportId: id,
      ownerId: user.id,
      message,
    });

    return NextResponse.json({ report: serializeReport(report) });
  } catch (error) {
    return problemResponse(error);
  }
}
