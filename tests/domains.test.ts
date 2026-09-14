import { describe, expect, it } from "vitest";
import { hostOf, isUserContentPath, resolveDomainAccess } from "@/core";

const config = { appUrl: "https://app.example.com", shareDomain: "share.example.com" };

describe("hostOf", () => {
  it("strips the scheme, path, and case", () => {
    expect(hostOf("https://App.Example.com/dashboard")).toBe("app.example.com");
    expect(hostOf("share.example.com")).toBe("share.example.com");
    expect(hostOf("http://localhost:3000")).toBe("localhost:3000");
  });
});

describe("isUserContentPath", () => {
  it("matches the read surface only", () => {
    expect(isUserContentPath("/n")).toBe(true);
    expect(isUserContentPath("/n/abc123")).toBe(true);
    expect(isUserContentPath("/notes/abc123")).toBe(false);
    expect(isUserContentPath("/dashboard")).toBe(false);
  });
});

describe("content domain isolation", () => {
  it("allows everything when both domains are the same host", () => {
    const decision = resolveDomainAccess({
      host: "localhost:3000",
      pathname: "/n/abc",
      appUrl: "http://localhost:3000",
      shareDomain: "localhost:3000",
    });
    expect(decision.action).toBe("allow");
  });

  it("redirects user content off the app domain", () => {
    const decision = resolveDomainAccess({
      ...config,
      host: "app.example.com",
      pathname: "/n/abc",
    });
    expect(decision).toEqual({
      action: "redirect",
      location: "https://share.example.com/n/abc",
      reason: "content_off_app",
    });
  });

  it("allows user content on the share domain", () => {
    const decision = resolveDomainAccess({
      ...config,
      host: "share.example.com",
      pathname: "/n/abc",
    });
    expect(decision.action).toBe("allow");
  });

  it("preserves the query string on redirect", () => {
    const decision = resolveDomainAccess({
      ...config,
      host: "app.example.com",
      pathname: "/n/abc",
      search: "?from=chat",
    });
    expect(decision).toEqual({
      action: "redirect",
      location: "https://share.example.com/n/abc?from=chat",
      reason: "content_off_app",
    });
  });

  it("redirects product pages off the share domain", () => {
    const decision = resolveDomainAccess({
      ...config,
      host: "share.example.com",
      pathname: "/dashboard",
    });
    expect(decision).toEqual({
      action: "redirect",
      location: "https://app.example.com/dashboard",
      reason: "app_off_content",
    });
  });

  it("never redirects the read page's own static assets", () => {
    for (const pathname of ["/read.css", "/favicon.ico", "/_next/static/chunk.js"]) {
      const decision = resolveDomainAccess({ ...config, host: "share.example.com", pathname });
      expect(decision.action).toBe("allow");
    }
  });
});
