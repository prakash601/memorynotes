import { NextResponse } from "next/server";
import { assertCronSecret, problemResponse } from "@/lib/http";
import { evaluateAndDispatchAlerts } from "@/lib/observability";

export const dynamic = "force-dynamic";

/**
 * Scheduled alert evaluation. Checks error rate, p95 latency, and job failures
 * against the live snapshot and dispatches anything that fires.
 */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const alerts = await evaluateAndDispatchAlerts();
    return NextResponse.json({ alerts, fired: alerts.length });
  } catch (error) {
    return problemResponse(error);
  }
}
