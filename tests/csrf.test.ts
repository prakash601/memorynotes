import { describe, expect, it } from "vitest";
import { createCsrfToken, csrfTokensMatch, passesCsrfCheck, requiresCsrfCheck } from "@/lib/csrf";

describe("csrf tokens", () => {
  it("creates a high-entropy url-safe token", () => {
    const token = createCsrfToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("creates unique tokens", () => {
    expect(createCsrfToken()).not.toBe(createCsrfToken());
  });

  it("matches identical tokens", () => {
    const token = createCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it("rejects different tokens", () => {
    expect(csrfTokensMatch(createCsrfToken(), createCsrfToken())).toBe(false);
  });

  it("rejects missing tokens", () => {
    expect(csrfTokensMatch(undefined, createCsrfToken())).toBe(false);
    expect(csrfTokensMatch(createCsrfToken(), null)).toBe(false);
    expect(csrfTokensMatch("", "")).toBe(false);
  });
});

describe("csrf check", () => {
  it("only requires a check on state-changing methods", () => {
    expect(requiresCsrfCheck("GET")).toBe(false);
    expect(requiresCsrfCheck("HEAD")).toBe(false);
    expect(requiresCsrfCheck("OPTIONS")).toBe(false);
    expect(requiresCsrfCheck("POST")).toBe(true);
    expect(requiresCsrfCheck("patch")).toBe(true);
    expect(requiresCsrfCheck("DELETE")).toBe(true);
  });

  it("rejects a state change without a valid token", () => {
    expect(
      passesCsrfCheck({ method: "POST", headerToken: null, cookieToken: createCsrfToken() }, false),
    ).toBe(false);

    expect(
      passesCsrfCheck(
        { method: "POST", headerToken: createCsrfToken(), cookieToken: createCsrfToken() },
        false,
      ),
    ).toBe(false);
  });

  it("accepts a state change with matching tokens", () => {
    const token = createCsrfToken();
    expect(passesCsrfCheck({ method: "POST", headerToken: token, cookieToken: token }, false)).toBe(
      true,
    );
  });

  it("exempts bearer-token requests and safe methods", () => {
    expect(passesCsrfCheck({ method: "POST", headerToken: null, cookieToken: null }, true)).toBe(
      true,
    );

    expect(passesCsrfCheck({ method: "GET", headerToken: null, cookieToken: null }, false)).toBe(
      true,
    );
  });
});
