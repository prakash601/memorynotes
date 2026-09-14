import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * OAuth discovery documents live under `/.well-known`, which is not a valid
   * route segment folder name, so they are served from API routes and rewritten
   * to the canonical well-known path (RFC 8414 and RFC 9728).
   */
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth/protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/oauth/protected-resource",
      },
    ];
  },
};

export default nextConfig;
