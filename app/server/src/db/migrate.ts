import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { APP_ROOT, getDb } from "./index";

const { db, client } = getDb();
const migrationsFolder = resolve(APP_ROOT, "drizzle");
await migrate(db, { migrationsFolder });
console.log(`Applied Drizzle migrations from ${migrationsFolder}`);
await client.end();
