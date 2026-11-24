import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  createRecurringRuleSchema,
  payRecurringRuleSchema,
  updateRecurringRuleSchema,
} from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { categories, recurringRules, transactions, wallets } from "../db/schema";
import { recordAuditLog } from "../lib/auditService";
import { jakartaToday, periodForDate } from "../lib/dates";
import { getSettings } from "../lib/settingsService";

export function createRecurringRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const [rules, allWallets] = await Promise.all([
      db.select().from(recurringRules).orderBy(recurringRules.dueDay),
      db.select().from(wallets),
    ]);
    const walletMap = new Map(allWallets.map((w) => [w.id, w.name]));

    const items = rules.map((r) => ({
      ...r,
      walletName: walletMap.get(r.walletId) ?? "Dompet",
      createdAt: r.createdAt.toISOString(),
    }));

    return c.json({ rules: items });
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createRecurringRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data tagihan rutin tidak valid." },
        400,
      );
    }

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, parsed.data.walletId))
      .limit(1);
    if (!wallet) return c.json({ error: "Dompet pembayaran tidak ditemukan." }, 404);

    const expenseCats = await db.select().from(categories).where(eq(categories.type, "expense"));
    const matchedCategory = expenseCats.find(
      (cat) => cat.name.trim().toLowerCase() === parsed.data.category.trim().toLowerCase(),
    );
    const canonicalCategory = matchedCategory?.name ?? parsed.data.category;
    const categoryId = matchedCategory?.id ?? null;

    const [inserted] = await db
      .insert(recurringRules)
      .values({
        merchant: parsed.data.merchant,
        amount: parsed.data.amount,
        category: canonicalCategory,
        categoryId,
        walletId: wallet.id,
        dueDay: parsed.data.dueDay,
        isActive: parsed.data.isActive ?? true,
      })
      .returning();

    if (!inserted) {
      return c.json({ error: "Gagal menyimpan aturan tagihan rutin." }, 500);
    }

    await recordAuditLog(db, {
      entityType: "recurring_rule",
      entityId: inserted.id,
      action: "create",
      before: null,
      after: {
        merchant: inserted.merchant,
        amount: inserted.amount,
        category: inserted.category,
        walletId: inserted.walletId,
        dueDay: inserted.dueDay,
      },
    });

    return c.json(
      {
        ok: true,
        rule: {
          ...inserted,
          walletName: wallet.name,
          createdAt: inserted.createdAt.toISOString(),
        },
      },
      201,
    );
  });

  const handleUpdate = async (c: import("hono").Context) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID aturan tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = updateRecurringRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data edit tidak valid." }, 400);
    }

    const [existing] = await db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, id))
      .limit(1);
    if (!existing) return c.json({ error: "Aturan tagihan rutin tidak ditemukan." }, 404);

    let nextCategoryId = existing.categoryId;
    let nextCategoryName = existing.category;
    if (parsed.data.category !== undefined) {
      const expenseCats = await db.select().from(categories).where(eq(categories.type, "expense"));
      const matched = expenseCats.find(
        (cat) => cat.name.trim().toLowerCase() === parsed.data.category!.trim().toLowerCase(),
      );
      if (matched) {
        nextCategoryName = matched.name;
        nextCategoryId = matched.id;
      } else {
        nextCategoryName = parsed.data.category;
        nextCategoryId = null;
      }
    }

    if (parsed.data.walletId !== undefined) {
      const [w] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.id, parsed.data.walletId))
        .limit(1);
      if (!w) return c.json({ error: "Dompet tidak ditemukan." }, 404);
    }

    const [updated] = await db
      .update(recurringRules)
      .set({
        ...parsed.data,
        category: nextCategoryName,
        categoryId: nextCategoryId,
      })
      .where(eq(recurringRules.id, id))
      .returning();

    await recordAuditLog(db, {
      entityType: "recurring_rule",
      entityId: id,
      action: "update",
      before: {
        merchant: existing.merchant,
        amount: existing.amount,
        category: existing.category,
        walletId: existing.walletId,
        dueDay: existing.dueDay,
        isActive: existing.isActive,
      },
      after: {
        merchant: updated?.merchant ?? existing.merchant,
        amount: updated?.amount ?? existing.amount,
        category: nextCategoryName,
        walletId: updated?.walletId ?? existing.walletId,
        dueDay: updated?.dueDay ?? existing.dueDay,
        isActive: updated?.isActive ?? existing.isActive,
      },
    });

    return c.json({ ok: true, rule: updated });
  };

  router.patch("/:id", handleUpdate);
  router.put("/:id", handleUpdate);

  router.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID aturan tidak valid." }, 400);

    const [existing] = await db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, id))
      .limit(1);
    if (!existing) return c.json({ error: "Aturan tagihan rutin tidak ditemukan." }, 404);

    await db.delete(recurringRules).where(eq(recurringRules.id, id));

    await recordAuditLog(db, {
      entityType: "recurring_rule",
      entityId: id,
      action: "delete",
      before: {
        merchant: existing.merchant,
        amount: existing.amount,
        category: existing.category,
        walletId: existing.walletId,
      },
      after: null,
    });

    return c.json({ ok: true });
  });

  router.post("/:id/pay", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID aturan tidak valid." }, 400);

    const body = await c.req.json().catch(() => ({}));
    const parsed = payRecurringRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data pembayaran tidak valid." },
        400,
      );
    }

    const [rule] = await db.select().from(recurringRules).where(eq(recurringRules.id, id)).limit(1);
    if (!rule) return c.json({ error: "Aturan tagihan rutin tidak ditemukan." }, 404);

    const today = jakartaToday();
    const settings = await getSettings(db);
    const targetPeriod =
      parsed.data.period ??
      periodForDate(today, "gajian", settings.gajianStartDay, settings.cardCutoffDay);

    const sourceRef = `recurring-${rule.id}-${targetPeriod}`;

    // Check idempotency: if already paid in this period
    const [existingTx] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.sourceRef, sourceRef))
      .limit(1);

    if (existingTx) {
      return c.json({
        ok: true,
        alreadyPaid: true,
        transactionId: existingTx.id,
        period: targetPeriod,
      });
    }

    const payWalletId = parsed.data.walletId ?? rule.walletId;
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, payWalletId)).limit(1);
    if (!wallet) return c.json({ error: "Dompet pembayaran tidak ditemukan." }, 404);

    const txDate = parsed.data.transactionDate ?? today;
    const payAmount = parsed.data.amount ?? rule.amount;

    const result = await db.transaction(async (tx) => {
      // 1. Mark rule as paid for target period
      await tx
        .update(recurringRules)
        .set({ lastPaidPeriod: targetPeriod })
        .where(eq(recurringRules.id, id));

      // 2. Insert expense transaction
      const [insertedTx] = await tx
        .insert(transactions)
        .values({
          type: "expense",
          merchant: rule.merchant,
          amount: payAmount,
          transactionDate: txDate,
          category: rule.category,
          categoryId: rule.categoryId,
          walletId: wallet.id,
          note: parsed.data.note?.trim() || `Pembayaran tagihan rutin periode ${targetPeriod}`,
          source: "system",
          sourceRef,
        })
        .returning({ id: transactions.id });

      return { transactionId: insertedTx!.id };
    });

    return c.json(
      {
        ok: true,
        alreadyPaid: false,
        transactionId: result.transactionId,
        period: targetPeriod,
      },
      201,
    );
  });

  return router;
}
