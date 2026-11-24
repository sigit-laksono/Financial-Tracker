import { Hono } from "hono";
import { dashboardQuerySchema } from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { buildDashboardData } from "../lib/ledger";

export function createDashboardRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const parsed = dashboardQuerySchema.safeParse({
      cycle: c.req.query("cycle"),
      period: c.req.query("period"),
    });
    if (!parsed.success) {
      return c.json({ error: "Parameter cycle atau period tidak valid." }, 400);
    }
    const data = await buildDashboardData(db, parsed.data);
    return c.json(data);
  });

  return router;
}
