import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { closeDb } from "@/db";
import {
  createApiToken,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  pkceChallengeFromVerifier,
  registerClient,
} from "@/core";
import { GET as listNotesRoute } from "@/app/api/v1/notes/route";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { createTestContext, createTestUser, describeWithDatabase, resetTables } from "./helpers/db";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function rpc(token: string | null, method: string, params?: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describeWithDatabase("mcp endpoint", () => {
  const { sql, db } = createTestContext();

  afterAll(async () => {
    await closeDb();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetTables(sql);
  });

  async function tokenFor(userId: string, scopes: string[]): Promise<string> {
    const { rawToken } = await createApiToken(db, { userId, name: "mcp", scopes });
    return rawToken;
  }

  async function callTool(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const response = await mcpPost(rpc(token, "tools/call", { name, arguments: args }));
    const body = (await response.json()) as { result: ToolResult };
    return body.result;
  }

  it("challenges an invalid token with the protected-resource metadata", async () => {
    const response = await mcpPost(rpc("mn_bogus", "initialize"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
  });

  it("initializes and lists all 12 tools", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read"]);

    const init = (await (await mcpPost(rpc(token, "initialize"))).json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(init.result.serverInfo.name).toBe("memorynotes");

    const list = (await (await mcpPost(rpc(token, "tools/list"))).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(list.result.tools).toHaveLength(12);
    expect(list.result.tools.map((tool) => tool.name)).toContain("create_note");
  });

  it("creates a note with a working share URL, idempotently", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);

    const first = await callTool(token, "create_note", {
      title: "From MCP",
      content: "# Hello",
      idempotency_key: "mcp-create-1",
    });
    const shareUrl = first.structuredContent?.share_url as string;
    expect(shareUrl).toContain("/n/");

    const second = await callTool(token, "create_note", {
      title: "From MCP",
      content: "# Hello",
      idempotency_key: "mcp-create-1",
    });
    expect(second.structuredContent?.id).toBe(first.structuredContent?.id);

    const [count] = await sql<{ count: number }[]>`select count(*)::int as count from notes`;
    expect(count.count).toBe(1);
  });

  it("returns note content framed as untrusted data", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);
    const created = await callTool(token, "create_note", { title: "Untrusted", content: "# Body" });
    const id = created.structuredContent?.id as string;

    const result = await callTool(token, "get_note", { id });
    expect(result.structuredContent?.content_is_untrusted).toBe(true);
    expect(result.structuredContent?.content).toBe("# Body");
  });

  it("stages lease edits and only applies them on commit", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write", "notes:publish"]);
    const created = await callTool(token, "create_note", { title: "Agent", content: "# start" });
    const id = created.structuredContent?.id as string;

    const begun = await callTool(token, "begin_edit", { id, ttl_seconds: 60 });
    const leaseToken = begun.structuredContent?.lease_token as string;
    expect(leaseToken).toMatch(/^lz_/);

    await callTool(token, "append_edit", { lease_token: leaseToken, content: "\nstaged line" });
    const beforeCommit = await callTool(token, "get_note", { id });
    expect(beforeCommit.structuredContent?.content).toBe("# start");

    const committed = await callTool(token, "commit_edit", {
      lease_token: leaseToken,
      mode: "stage",
    });
    expect(committed.structuredContent?.revision).toBe(2);

    const afterCommit = await callTool(token, "get_note", { id });
    expect(afterCommit.structuredContent?.content).toBe("# start\nstaged line");
  });

  it("discards staged edits on abort", async () => {
    const userId = await createTestUser(sql);
    const token = await tokenFor(userId, ["notes:read", "notes:write"]);
    const created = await callTool(token, "create_note", { title: "Agent", content: "# start" });
    const id = created.structuredContent?.id as string;

    const begun = await callTool(token, "begin_edit", { id });
    const leaseToken = begun.structuredContent?.lease_token as string;
    await callTool(token, "append_edit", { lease_token: leaseToken, content: " discard me" });
    await callTool(token, "abort_edit", { lease_token: leaseToken });

    const after = await callTool(token, "get_note", { id });
    expect(after.structuredContent?.content).toBe("# start");
  });

  it("denies publish and delete to a notes:read token", async () => {
    const userId = await createTestUser(sql);
    const writer = await tokenFor(userId, ["notes:read", "notes:write"]);
    const created = await callTool(writer, "create_note", { title: "Guarded", content: "# Body" });
    const id = created.structuredContent?.id as string;

    const reader = await tokenFor(userId, ["notes:read"]);
    const publish = await callTool(reader, "publish_note", { id, message: "no" });
    expect(publish.isError).toBe(true);
    expect(publish.content[0].text).toContain("forbidden");

    const remove = await callTool(reader, "delete_note", { id, confirm: true });
    expect(remove.isError).toBe(true);

    // The note is untouched.
    const still = await callTool(writer, "get_note", { id });
    expect(still.structuredContent?.content).toBe("# Body");
  });

  it("accepts an OAuth access token on MCP and the plain API", async () => {
    const userId = await createTestUser(sql);
    const { client } = await registerClient(db, {
      clientName: "OAuth Dummy",
      redirectUris: ["https://dummy.example/callback"],
      scopes: ["notes:read", "notes:write", "notes:publish"],
    });

    const codeVerifier = randomBytes(32).toString("base64url");
    const code = await issueAuthorizationCode(db, {
      clientId: client.id,
      userId,
      redirectUri: "https://dummy.example/callback",
      scopes: ["notes:read", "notes:write", "notes:publish"],
      codeChallenge: pkceChallengeFromVerifier(codeVerifier),
    });
    const tokens = await exchangeAuthorizationCode(db, {
      code,
      clientId: client.id,
      redirectUri: "https://dummy.example/callback",
      codeVerifier,
    });

    // MCP works with the OAuth token.
    const list = (await (await mcpPost(rpc(tokens.accessToken, "tools/list"))).json()) as {
      result: { tools: unknown[] };
    };
    expect(list.result.tools).toHaveLength(12);

    // So does the plain HTTP API: the fallback path.
    const plain = await listNotesRoute(
      new Request("http://localhost:3000/api/v1/notes", {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      }),
    );
    expect(plain.status).toBe(200);
  });
});
