import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createApp } from "./app";
import { APP_ROOT, getDb } from "./db";
import { ensureDefaultSeed } from "./db/seed";
import { runDailyLedgerSync } from "./lib/ledger";

const { db, client } = getDb();
const migrationsFolder = resolve(APP_ROOT, "drizzle");
await migrate(db, { migrationsFolder });
await ensureDefaultSeed(db);
await runDailyLedgerSync(db);

const app = createApp(db);

const distDir = resolve(APP_ROOT, "client/dist");
if (existsSync(distDir)) {
  const staticMiddleware = serveStatic({ root: distDir });
  const spaFallback = serveStatic({ path: resolve(distDir, "index.html") });
  app.use("/*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    return staticMiddleware(c, next);
  });
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    return spaFallback(c, next);
  });
}

const port = Number(process.env.PORT ?? 3001);
const server = Bun.serve({
  port,
  fetch: app.fetch,
});
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    event: "server_started",
    url: `http://localhost:${server.port}`,
  }),
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "server_stopping",
      signal,
    }),
  );
  try {
    server.stop(true);
    await client.end({ timeout: 5 });
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
