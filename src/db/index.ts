import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let sql: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

/**
 * Lazily constructs the connection so importing this module never requires a
 * live database. `prepare: false` keeps us compatible with Supabase's
 * transaction pooler.
 */
export function getDb(): Database {
  if (!database) {
    const env = getEnv();
    sql = postgres(env.DATABASE_URL, { max: 10, prepare: false });
    database = drizzle(sql, { schema });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = undefined;
    database = undefined;
  }
}

export { schema };
