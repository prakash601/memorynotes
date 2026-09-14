import { NextResponse } from "next/server";
import { MCP_PROTOCOL_VERSION, MCP_TOOLS, callMcpTool, isDomainError } from "@/core";
import { getDb } from "@/db";
import { getEnv } from "@/env";
import { authenticate } from "@/lib/auth";
import { getIdempotencyStore } from "@/lib/idempotency";
import { observed } from "@/lib/observability";
import { limit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

function rpcResult(id: string | number | null, result: unknown): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result },
    { headers: { "cache-control": "no-store" } },
  );
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

function unauthorized(): NextResponse {
  const app = getEnv().APP_URL.replace(/\/$/, "");
  return NextResponse.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${app}/.well-known/oauth-protected-resource"`,
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * MCP Streamable HTTP endpoint (doc 09). JSON-RPC over POST; the tool surface is
 * the framework-free `src/core/mcp.ts`, so other platforms reuse it (ADR-0006).
 */
async function handlePost(request: Request) {
  let principal;
  try {
    principal = await authenticate(request);
  } catch (error) {
    if (isDomainError(error) && error.code === "unauthorized") {
      return unauthorized();
    }
    if (isDomainError(error) && error.code === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw error;
  }

  await limit("mcp_token_minute", principal.tokenId ?? principal.userId);

  let rpc: JsonRpcRequest;
  try {
    rpc = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const id = rpc.id ?? null;

  switch (rpc.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "memorynotes", version: "0.1.0" },
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202 });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: MCP_TOOLS });

    case "tools/call": {
      const params = (rpc.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const name = params.name ?? "";
      const args = params.arguments ?? {};

      if (name === "create_note") {
        await limit("mcp_create_hour", principal.tokenId ?? principal.userId);
      }

      try {
        const result = await callMcpTool(
          {
            db: getDb(),
            userId: principal.userId,
            scopes: principal.scopes,
            idempotency: getIdempotencyStore(),
          },
          name,
          args,
        );
        return rpcResult(id, result);
      } catch (error) {
        // Tool failures are results with isError, not protocol errors.
        if (isDomainError(error)) {
          return rpcResult(id, {
            content: [{ type: "text", text: `${error.code}: ${error.message}` }],
            isError: true,
          });
        }
        throw error;
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${rpc.method}`);
  }
}

export const POST = observed("mcp", handlePost);

/** Streamable HTTP is POST-only here; GET (server-initiated SSE) is not used. */
export async function GET() {
  return NextResponse.json(
    { error: "method_not_allowed", error_description: "Use POST for MCP Streamable HTTP" },
    { status: 405, headers: { allow: "POST" } },
  );
}
