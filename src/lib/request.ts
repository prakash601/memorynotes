import { createHash } from "node:crypto";
import { getEnv } from "@/env";

/**
 * Client IP as seen by the platform. Trusts the first hop of
 * `x-forwarded-for`, which is what the host sets; the value is only ever
 * stored hashed (P3).
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`${getEnv().AUTH_SECRET}:ip:${ip}`).digest("hex");
}
