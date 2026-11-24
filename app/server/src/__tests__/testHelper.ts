import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createApp } from "../app";
import * as schema from "../db/schema";
import { ensureDefaultSeed } from "../db/seed";
import { LoginRateLimiter } from "../lib/auth";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/financial_tracker_test";

export interface TestContext {
  db: PostgresJsDatabase<typeof schema>;
  client: postgres.Sql;
  schemaName: string;
  app: ReturnType<typeof createApp>;
  rateLimiter: LoginRateLimiter;
  sqlite: {
    close: () => Promise<void>;
  };
  cleanup: () => Promise<void>;
}

const migrationSql = readFileSync(
  resolve(import.meta.dir, "../../../drizzle/0000_wide_zaran.sql"),
  "utf8",
);

export async function setupTestContext(options: { seed?: boolean } = {}): Promise<TestContext> {
  const schemaName = `test_${crypto.randomUUID().replace(/-/g, "")}`;
  const adminClient = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await adminClient.unsafe(`CREATE SCHEMA ${schemaName};`);

  const separator = TEST_DATABASE_URL.includes("?") ? "&" : "?";
  const urlWithSearchPath = `${TEST_DATABASE_URL}${separator}options=-csearch_path%3D${schemaName}`;

  const client = postgres(urlWithSearchPath, {
    max: 5,
    idle_timeout: 10,
    onnotice: () => {},
  });

  await client.unsafe(migrationSql);

  const db = drizzle(client, { schema });

  if (options.seed ?? true) {
    await ensureDefaultSeed(db);
  }

  const rateLimiter = new LoginRateLimiter();
  const app = createApp(db, {
    secret: "test-secret-key-32-chars-long!!",
    rateLimiter,
    logRequests: false,
  });

  const cleanup = async () => {
    try {
      await client.end({ timeout: 2 });
    } catch {}
    try {
      await adminClient.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE;`);
    } catch {}
    try {
      await adminClient.end({ timeout: 2 });
    } catch {}
  };

  return {
    db,
    client,
    schemaName,
    app,
    rateLimiter,
    sqlite: {
      close: cleanup,
    },
    cleanup,
  };
}
