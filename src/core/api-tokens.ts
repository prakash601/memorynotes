import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { apiTokens, users, type ApiToken } from "@/db/schema";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "./errors";
import { hashToken } from "./tokens";

/** Scopes mirror the HTTP API (doc 09). */
export const API_SCOPES = [
  "notes:read",
  "notes:write",
  "notes:publish",
  "notes:share",
  "notes:delete",
  "account:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const TOKEN_PREFIX = "mn_";
const TOKEN_BYTES = 32;

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export function generateApiToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

function hashApiToken(rawToken: string): string {
  return hashToken(rawToken);
}

/** Short, non-secret display prefix. */
export function apiTokenPrefix(rawToken: string): string {
  return rawToken.slice(0, TOKEN_PREFIX.length + 6);
}

function normalizeScopes(scopes: string[] | undefined): ApiScope[] {
  if (!scopes || scopes.length === 0) {
    return [...API_SCOPES];
  }
  const validated: ApiScope[] = [];
  for (const scope of new Set(scopes)) {
    if (!isApiScope(scope)) {
      throw new ValidationError(`Unknown scope: ${scope}`);
    }
    validated.push(scope);
  }
  return validated;
}

export interface CreateApiTokenInput {
  userId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
}

/** The raw token is returned once and never stored; only its hash is kept. */
export async function createApiToken(
  db: Database,
  input: CreateApiTokenInput,
): Promise<{ token: ApiToken; rawToken: string }> {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError("A token needs a name");
  }

  const rawToken = generateApiToken();
  const [token] = await db
    .insert(apiTokens)
    .values({
      userId: input.userId,
      name,
      tokenHash: hashApiToken(rawToken),
      tokenPrefix: apiTokenPrefix(rawToken),
      scopes: normalizeScopes(input.scopes),
      expiresAt: input.expiresAt ?? null,
    })
    .returning();

  return { token, rawToken };
}

export async function listApiTokens(db: Database, userId: string): Promise<ApiToken[]> {
  return db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(
  db: Database,
  input: { tokenId: string; userId: string; now?: Date },
): Promise<void> {
  const [revoked] = await db
    .update(apiTokens)
    .set({ revokedAt: input.now ?? new Date() })
    .where(
      and(
        eq(apiTokens.id, input.tokenId),
        eq(apiTokens.userId, input.userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });

  if (!revoked) {
    throw new NotFoundError("Token not found");
  }
}

export interface ResolvedApiToken {
  token: ApiToken;
  userId: string;
  email: string | null;
}

/**
 * Resolves a presented bearer token. Revoked and expired tokens are rejected
 * the same way as unknown ones, and a successful use updates `last_used_at`.
 */
export async function resolveApiToken(
  db: Database,
  rawToken: string,
  now: Date = new Date(),
): Promise<ResolvedApiToken> {
  const [row] = await db
    .select({ token: apiTokens, email: users.email })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hashApiToken(rawToken)))
    .limit(1);

  if (!row) {
    throw new UnauthorizedError("Invalid API token");
  }
  const { token } = row;
  if (token.revokedAt || (token.expiresAt && token.expiresAt.getTime() <= now.getTime())) {
    throw new UnauthorizedError("Invalid API token");
  }

  await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, token.id));

  return { token, userId: token.userId, email: row.email };
}

/** A token may only do what its scopes allow (doc 09). */
export function assertScope(token: ApiToken, scope: ApiScope): void {
  if (!token.scopes.includes(scope)) {
    throw new ForbiddenError(`This token is missing the ${scope} scope`);
  }
}
