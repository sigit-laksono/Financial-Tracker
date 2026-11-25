import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppDb } from "./db";
import {
  createAuthMiddleware,
  createCsrfGuard,
  getSessionSecret,
  type LoginRateLimiter,
} from "./lib/auth";
import { DomainError } from "./lib/errors";
import { MAX_PG_INT } from "../../shared/src/schemas";
import { createAssetRoutes } from "./routes/assets";
import { createAuthRoutes } from "./routes/auth";
import { createBudgetRoutes } from "./routes/budgets";
import { createCategoryRoutes } from "./routes/categories";
import { createDashboardRoutes } from "./routes/dashboard";
import { createDebtRoutes, createInstallmentRoutes } from "./routes/debts";
import { createExportRoutes } from "./routes/export";
import { createGoalRoutes } from "./routes/goals";
import { createLedgerRoutes } from "./routes/ledger";
import { createRecurringRoutes } from "./routes/recurring";
import { createSettingsRoutes } from "./routes/settings";
import { createTransactionRoutes } from "./routes/transactions";
import { createWalletRoutes } from "./routes/wallets";

const APP_VERSION = process.env.APP_VERSION ?? "0.1.0";

export function createApp(
  db: AppDb,
  options: { secret?: string; rateLimiter?: LoginRateLimiter; logRequests?: boolean } = {},
) {
  const app = new Hono();
  const secret = options.secret ?? getSessionSecret();
  const shouldLog =
    options.logRequests ??
    (process.env.NODE_ENV !== "test" && process.env.LOG_REQUESTS !== "false");

  app.use("*", secureHeaders());

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    const startMs = performance.now();
    await next();
    c.header("X-Request-Id", requestId);
    if (shouldLog) {
      const durationMs = Math.round((performance.now() - startMs) * 100) / 100;
      const status = c.res.status;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
          requestId,
          method: c.req.method,
          path: c.req.path,
          status,
          durationMs,
        }),
      );
    }
  });

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: err.message, code: err.code }, err.status);
    }
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        method: c.req.method,
        path: c.req.path,
        message: err instanceof Error ? err.message : "Unhandled error",
      }),
    );
    return c.json({ error: "Terjadi kesalahan internal server.", code: "INTERNAL_ERROR" }, 500);
  });

  app.get("/api/health", async (c) => {
    try {
      await db.execute(sql`SELECT 1 AS ok`);
      return c.json({
        ok: true,
        db: "ready",
        version: APP_VERSION,
        timestamp: new Date().toISOString(),
      });
    } catch {
      return c.json(
        {
          ok: false,
          db: "unavailable",
          version: APP_VERSION,
          timestamp: new Date().toISOString(),
        },
        503,
      );
    }
  });

  app.use("/api/*", createCsrfGuard());
  // Postgres ids are int4. A larger numeric path id would make the query throw (500), so reject
  // it up front for every route.
  app.use("/api/*", async (c, next) => {
    for (const segment of c.req.path.split("/")) {
      if (/^\d+$/.test(segment) && Number(segment) > MAX_PG_INT) {
        return c.json({ error: "ID tidak valid." }, 400);
      }
    }
    return next();
  });
  app.use("/api/*", createAuthMiddleware(db, secret));

  app.route("/api/auth", createAuthRoutes(db, { secret, rateLimiter: options.rateLimiter }));
  app.route("/api/dashboard", createDashboardRoutes(db));
  app.route("/api/wallets", createWalletRoutes(db));
  app.route("/api/transactions", createTransactionRoutes(db));
  app.route("/api/debts", createDebtRoutes(db));
  app.route("/api/installments", createInstallmentRoutes(db));
  app.route("/api/categories", createCategoryRoutes(db));
  app.route("/api/budgets", createBudgetRoutes(db));
  app.route("/api/goals", createGoalRoutes(db));
  app.route("/api/assets", createAssetRoutes(db));
  app.route("/api/recurring", createRecurringRoutes(db));
  app.route("/api/settings", createSettingsRoutes(db));
  app.route("/api/export", createExportRoutes(db));
  app.route("/api/ledger", createLedgerRoutes(db));

  app.all("/api/*", (c) => c.json({ error: "Endpoint API tidak ditemukan." }, 404));

  return app;
}
