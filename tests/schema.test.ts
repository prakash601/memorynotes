import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/**
 * Asserts the migrations create every table from the design doc (doc 03).
 * Skips when DATABASE_URL is absent so unit test runs stay fast; CI provides
 * a Postgres service and runs this for real.
 */
const expectedTables = [
  // Auth.js adapter
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  // Core notes
  "notes",
  "note_drafts",
  "note_versions",
  // Sharing and leases
  "note_shares",
  "note_leases",
  // Machine auth
  "api_tokens",
  "oauth_clients",
  "oauth_authorization_codes",
  "oauth_tokens",
  "oauth_consents",
  // Safety and audit
  "reports",
  "moderation_events",
  "activity_log",
];

const expectedIndexes = [
  "note_shares_one_active_idx",
  "note_shares_token_hash_unique",
  "note_versions_number_unique",
  "users_email_unique",
  "activity_log_target_idx",
];

describeWithDatabase("database schema", () => {
  const sql = postgres(databaseUrl ?? "", { max: 1, onnotice: () => {} });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("creates every table from the design doc", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `;
    const present = new Set(rows.map((row) => row.table_name));

    const missing = expectedTables.filter((table) => !present.has(table));
    expect(missing).toEqual([]);
  });

  it("creates the constraint-critical indexes", async () => {
    const rows = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'public'
    `;
    const present = new Set(rows.map((row) => row.indexname));

    const missing = expectedIndexes.filter((index) => !present.has(index));
    expect(missing).toEqual([]);
  });

  it("keeps note_drafts to exactly one row per note", async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name
      from information_schema.key_column_usage
      where table_name = 'note_drafts'
        and constraint_name = 'note_drafts_pkey'
    `;
    expect(rows.map((row) => row.column_name)).toEqual(["note_id"]);
  });
});
