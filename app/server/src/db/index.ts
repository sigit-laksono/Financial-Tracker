import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export const APP_ROOT = resolve(import.meta.dir, "../../..");

export function resolveDatabaseUrl(): string {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL wajib diset saat NODE_ENV=production.");
  }
  return "postgres://postgres:postgres@localhost:5432/financial_tracker";
}

export interface DbInstance {
  db: PostgresJsDatabase<typeof schema>;
  client: postgres.Sql;
  databaseUrl: string;
}

export function createDb(
  databaseUrl = resolveDatabaseUrl(),
  options: postgres.Options<any> = {},
): DbInstance {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    ...options,
  });
  const db = drizzle(client, { schema });
  return { db, client, databaseUrl };
}

let cachedInstance: DbInstance | null = null;

export function getDb(): DbInstance {
  if (!cachedInstance) {
    cachedInstance = createDb();
  }
  return cachedInstance;
}

export async function checkDbReadiness(client: postgres.Sql = getDb().client): Promise<boolean> {
  try {
    const res = await client`SELECT 1 AS ok`;
    return Boolean(res && res.length > 0);
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (cachedInstance) {
    await cachedInstance.client.end({ timeout: 5 });
    cachedInstance = null;
  }
}

export type AppDb = PostgresJsDatabase<typeof schema>;
export type AppTransaction = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
