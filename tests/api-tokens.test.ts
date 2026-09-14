import { afterAll, beforeEach, expect, it } from "vitest";
import {
  assertScope,
  createApiToken,
  listApiTokens,
  resolveApiToken,
  revokeApiToken,
} from "@/core";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

describeWithDatabase("api tokens", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  it("creates a token and returns the raw value once, storing only a hash", async () => {
    const userId = await createTestUser(sql);
    const { token, rawToken } = await createApiToken(db, { userId, name: "CLI" });

    expect(rawToken).toMatch(/^mn_/);
    expect(token.tokenHash).not.toContain(rawToken);
    expect(token.tokenPrefix).toBe(rawToken.slice(0, 9));

    const [stored] = await sql<{ token_hash: string; raw: string | null }[]>`
      select token_hash, token_hash as raw from api_tokens
    `;
    expect(stored.token_hash).not.toBe(rawToken);
  });

  it("resolves a presented token to its account and records use", async () => {
    const userId = await createTestUser(sql);
    const { rawToken, token } = await createApiToken(db, {
      userId,
      name: "CLI",
      scopes: ["notes:read"],
    });

    const resolved = await resolveApiToken(db, rawToken);
    expect(resolved.userId).toBe(userId);
    expect(resolved.token.id).toBe(token.id);

    const [row] = await sql<{ last_used_at: Date | null }[]>`
      select last_used_at from api_tokens where id = ${token.id}
    `;
    expect(row.last_used_at).not.toBeNull();
  });

  it("rejects unknown, revoked, and expired tokens", async () => {
    const userId = await createTestUser(sql);
    const { rawToken, token } = await createApiToken(db, { userId, name: "CLI" });

    await expect(resolveApiToken(db, "mn_not-a-real-token")).rejects.toMatchObject({
      code: "unauthorized",
    });

    await revokeApiToken(db, { tokenId: token.id, userId });
    await expect(resolveApiToken(db, rawToken)).rejects.toMatchObject({ code: "unauthorized" });

    const expired = await createApiToken(db, {
      userId,
      name: "Old",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    await expect(resolveApiToken(db, expired.rawToken)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("lists only active tokens", async () => {
    const userId = await createTestUser(sql);
    const first = await createApiToken(db, { userId, name: "One" });
    await createApiToken(db, { userId, name: "Two" });
    await revokeApiToken(db, { tokenId: first.token.id, userId });

    const tokens = await listApiTokens(db, userId);
    expect(tokens.map((token) => token.name)).toEqual(["Two"]);
  });

  it("rejects an unknown scope", async () => {
    const userId = await createTestUser(sql);
    await expect(
      createApiToken(db, { userId, name: "Bad", scopes: ["notes:admin"] }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("enforces scopes", async () => {
    const userId = await createTestUser(sql);
    const { token } = await createApiToken(db, { userId, name: "Read", scopes: ["notes:read"] });

    expect(() => assertScope(token, "notes:write")).toThrowError(/notes:write/);
    expect(() => assertScope(token, "notes:read")).not.toThrow();
  });
});
