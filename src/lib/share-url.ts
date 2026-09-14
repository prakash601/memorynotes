import { getEnv } from "@/env";

/** Builds the public read URL for a raw share token. */
export function buildShareUrl(rawToken: string): string {
  const { SHARE_DOMAIN } = getEnv();
  const hasScheme = SHARE_DOMAIN.startsWith("http://") || SHARE_DOMAIN.startsWith("https://");
  const base = hasScheme ? SHARE_DOMAIN : `https://${SHARE_DOMAIN}`;
  return `${base.replace(/\/$/, "")}/n/${rawToken}`;
}
