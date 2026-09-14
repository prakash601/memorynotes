import { assertCronSecret, problemResponse } from "@/lib/http";
import { renderMetrics } from "@/lib/observability";

export const dynamic = "force-dynamic";

/** Prometheus text exposition. Guarded by the scheduler secret, never public. */
export async function GET(request: Request) {
  try {
    assertCronSecret(request);
    return new Response(renderMetrics(), {
      headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
    });
  } catch (error) {
    return problemResponse(error);
  }
}
