import { Hono } from "hono";
import { z } from "zod";
import { receiveSalarySchema, yearMonthSchema } from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { jakartaToday } from "../lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import { getSalaryPreview, receiveSalaryForPeriod } from "../lib/salaryService";
import { runDailyLedgerSync } from "../lib/ledgerSnapshot";

const syncBodySchema = z.object({
  cycleKey: yearMonthSchema.optional(),
  force: z.boolean().optional(),
});

export function createLedgerRoutes(db: AppDb) {
  const router = new Hono();

  router.post("/sync", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = syncBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Payload sync tidak valid." }, 400);
    }

    const result = await runDailyLedgerSync(db, jakartaToday(), {
      force: parsed.data.force,
      extraCcCycles: parsed.data.cycleKey ? [parsed.data.cycleKey] : undefined,
    });
    return c.json({ ok: true, ...result });
  });

  router.get("/salary-preview", async (c) => {
    const period = c.req.query("period");
    const grossSalaryRaw = c.req.query("grossSalary");
    const walletIdRaw = c.req.query("walletId");

    const grossSalary = grossSalaryRaw ? Number(grossSalaryRaw) : undefined;
    const walletId = walletIdRaw ? Number(walletIdRaw) : undefined;

    const preview = await getSalaryPreview(db, {
      period: period || undefined,
      grossSalary: Number.isFinite(grossSalary) ? grossSalary : undefined,
      walletId: Number.isFinite(walletId) ? walletId : undefined,
    });

    return c.json({ ok: true, ...preview });
  });

  router.post("/receive-salary", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = receiveSalarySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Payload terima gaji tidak valid." },
        400,
      );
    }

    try {
      const result = await receiveSalaryForPeriod(db, parsed.data);
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof ConflictError) {
        return c.json({ error: err.message }, 409);
      }
      if (err instanceof ValidationError) {
        return c.json({ error: err.message }, 400);
      }
      if (err instanceof NotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  return router;
}
