import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";

/** Integration tests need a real database; they skip without one. */
export const hasDatabase = Boolean(process.env.DATABASE_URL);
export const describeWithDatabase = hasDatabase ? describe : describe.skip;

export interface TestContext {
  sql: ReturnType<typeof postgres>;
  db: Database;
}

export function createTestContext(): TestContext {
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }) };
}

/** Truncating users cascades to notes, drafts, versions, shares, and leases. */
export async function resetTables(sql: TestContext["sql"]): Promise<void> {
  await sql`truncate table users cascade`;
}

export async function createTestUser(sql: TestContext["sql"], label = "tester"): Promise<string> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const [row] = await sql<{ id: string }[]>`
    insert into users (email, name) values (${email}, ${label}) returning id
  `;
  return row.id;
}
