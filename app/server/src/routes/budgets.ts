import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { Hono } from "hono";
import type { BudgetCategorySummary, BudgetOverviewDto } from "../../../shared/src/dtos";
import { upsertBudgetSchema } from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { budgets, categories, transactionSplits, transactions } from "../db/schema";
import { resolveBudgetsForPeriod } from "../lib/budgetService";
import { isValidYearMonth, jakartaToday, periodBounds, periodForDate } from "../lib/dates";
import { getSettings } from "../lib/settingsService";

export function createBudgetRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const queryPeriod = c.req.query("period");
    if (queryPeriod !== undefined && !isValidYearMonth(queryPeriod)) {
      return c.json({ error: "Parameter period harus YYYY-MM yang valid." }, 400);
    }

    const today = jakartaToday();
    const settings = await getSettings(db);
    const requestedPeriod =
      queryPeriod ??
      periodForDate(today, "gajian", settings.gajianStartDay, settings.cardCutoffDay);
    const bounds = periodBounds(
      requestedPeriod,
      "gajian",
      settings.gajianStartDay,
      settings.cardCutoffDay,
    );

    const [budgetRows, txRows] = await Promise.all([
      db.select().from(budgets),
      db
        .select({
          id: transactions.id,
          category: transactions.category,
          amount: transactions.amount,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.type, "expense"),
            eq(transactions.isConvertedToInstallment, false),
            gte(transactions.transactionDate, bounds.start),
            lte(transactions.transactionDate, bounds.end),
          ),
        ),
    ]);

    const txIds = txRows.map((r) => r.id);
    const splitRows =
      txIds.length > 0
        ? await db
            .select()
            .from(transactionSplits)
            .where(inArray(transactionSplits.transactionId, txIds))
        : [];

    const splitsByTxId = new Map<number, typeof splitRows>();
    for (const s of splitRows) {
      const arr = splitsByTxId.get(s.transactionId) ?? [];
      arr.push(s);
      splitsByTxId.set(s.transactionId, arr);
    }

    const spentByCategory = new Map<string, number>();
    for (const r of txRows) {
      const splits = splitsByTxId.get(r.id);
      if (splits && splits.length > 0) {
        for (const s of splits) {
          spentByCategory.set(s.category, (spentByCategory.get(s.category) ?? 0) + s.amount);
        }
      } else {
        spentByCategory.set(r.category, (spentByCategory.get(r.category) ?? 0) + r.amount);
      }
    }

    const items = resolveBudgetsForPeriod(
      budgetRows,
      requestedPeriod,
      spentByCategory,
      bounds.end,
      today,
    );

    return c.json({ period: requestedPeriod, budgets: items });
  });

  router.get("/summary", async (c) => {
    const queryPeriod = c.req.query("period");
    if (queryPeriod !== undefined && !isValidYearMonth(queryPeriod)) {
      return c.json({ error: "Parameter period harus YYYY-MM yang valid." }, 400);
    }

    const today = jakartaToday();
    const settings = await getSettings(db);
    const requestedPeriod =
      queryPeriod ??
      periodForDate(today, "gajian", settings.gajianStartDay, settings.cardCutoffDay);
    const bounds = periodBounds(
      requestedPeriod,
      "gajian",
      settings.gajianStartDay,
      settings.cardCutoffDay,
    );

    const [budgetRows, categoryRows, txRows, incomeRows] = await Promise.all([
      db.select().from(budgets),
      db.select().from(categories).where(eq(categories.isArchived, false)),
      db
        .select({
          id: transactions.id,
          category: transactions.category,
          amount: transactions.amount,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.type, "expense"),
            eq(transactions.isConvertedToInstallment, false),
            gte(transactions.transactionDate, bounds.start),
            lte(transactions.transactionDate, bounds.end),
          ),
        ),
      db
        .select({
          amount: transactions.amount,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.type, "income"),
            gte(transactions.transactionDate, bounds.start),
            lte(transactions.transactionDate, bounds.end),
          ),
        ),
    ]);

    const actualIncome = incomeRows.reduce((sum, r) => sum + r.amount, 0);
    const estimatedIncome =
      settings.netSalary > 0 ? settings.netSalary : actualIncome > 0 ? actualIncome : 5_000_000;

    const defaultMap = new Map<string, typeof budgets.$inferSelect>();
    const overrideMap = new Map<string, typeof budgets.$inferSelect>();
    for (const b of budgetRows) {
      if (b.period === "default") defaultMap.set(b.category.toLowerCase(), b);
      else if (b.period === requestedPeriod) overrideMap.set(b.category.toLowerCase(), b);
    }

    const spentMap = new Map<string, number>();
    for (const t of txRows) {
      const k = t.category.toLowerCase();
      spentMap.set(k, (spentMap.get(k) ?? 0) + t.amount);
    }

    const expenseCategories = categoryRows.filter((c) => c.type === "expense");
    const categorySummaries: BudgetCategorySummary[] = expenseCategories.map((cat) => {
      const k = cat.name.toLowerCase();
      const budgetRow = overrideMap.get(k) ?? defaultMap.get(k);
      const budgetLimit = budgetRow?.limitAmount ?? 0;
      const actualSpent = spentMap.get(k) ?? 0;
      const remaining = budgetLimit - actualSpent;
      const percentUsed = budgetLimit > 0 ? Math.round((actualSpent / budgetLimit) * 100) : 0;
      const status: "safe" | "warning" | "exceeded" =
        percentUsed >= 100 ? "exceeded" : percentUsed >= 80 ? "warning" : "safe";

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        bucket: cat.bucket,
        color: cat.color,
        budgetLimit,
        actualSpent,
        remaining,
        percentUsed,
        status,
      };
    });

    const needsCats = categorySummaries.filter((c) => c.bucket === "needs");
    const wantsCats = categorySummaries.filter((c) => c.bucket === "wants");
    const savingsCats = categorySummaries.filter((c) => c.bucket === "savings");

    const needsBucketBudget = overrideMap.get("bucket:needs") ?? defaultMap.get("bucket:needs");
    const wantsBucketBudget = overrideMap.get("bucket:wants") ?? defaultMap.get("bucket:wants");
    const savingsBucketBudget = overrideMap.get("bucket:savings") ?? defaultMap.get("bucket:savings");

    const needsSubAllocated = needsCats.reduce((sum, c) => sum + c.budgetLimit, 0);
    const wantsSubAllocated = wantsCats.reduce((sum, c) => sum + c.budgetLimit, 0);
    const savingsSubAllocated = savingsCats.reduce((sum, c) => sum + c.budgetLimit, 0);

    const needsAllocated = needsBucketBudget ? needsBucketBudget.limitAmount : needsSubAllocated;
    const wantsAllocated = wantsBucketBudget ? wantsBucketBudget.limitAmount : wantsSubAllocated;
    const savingsAllocated = savingsBucketBudget ? savingsBucketBudget.limitAmount : savingsSubAllocated;
    const totalAllocated = needsAllocated + wantsAllocated + savingsAllocated;

    const summary: BudgetOverviewDto = {
      period: requestedPeriod,
      estimatedIncome,
      totalAllocated,
      unallocated: estimatedIncome - totalAllocated,
      needs: {
        idealPercent: 50,
        allocated: needsAllocated,
        allocatedPercent:
          estimatedIncome > 0 ? Math.round((needsAllocated / estimatedIncome) * 100) : 0,
        spent: needsCats.reduce((sum, c) => sum + c.actualSpent, 0),
        categories: needsCats,
      },
      wants: {
        idealPercent: 30,
        allocated: wantsAllocated,
        allocatedPercent:
          estimatedIncome > 0 ? Math.round((wantsAllocated / estimatedIncome) * 100) : 0,
        spent: wantsCats.reduce((sum, c) => sum + c.actualSpent, 0),
        categories: wantsCats,
      },
      savings: {
        idealPercent: 20,
        allocated: savingsAllocated,
        allocatedPercent:
          estimatedIncome > 0 ? Math.round((savingsAllocated / estimatedIncome) * 100) : 0,
        spent: savingsCats.reduce((sum, c) => sum + c.actualSpent, 0),
        categories: savingsCats,
      },
    };

    return c.json(summary);
  });

  router.put("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = upsertBudgetSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data budget tidak valid." }, 400);
    }

    const expenseCats = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.type, "expense"));
    const matchedCat = expenseCats.find(
      (cat) => cat.name.trim().toLowerCase() === parsed.data.category.toLowerCase(),
    );
    const canonicalName = matchedCat?.name ?? parsed.data.category;

    const existing = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.category, canonicalName), eq(budgets.period, parsed.data.period)))
      .limit(1);

    if (parsed.data.limitAmount <= 0) {
      if (existing[0]) {
        await db.delete(budgets).where(eq(budgets.id, existing[0].id));
      }
      return c.json({ ok: true, budget: null });
    }

    if (existing[0]) {
      const [updated] = await db
        .update(budgets)
        .set({
          limitAmount: parsed.data.limitAmount,
          categoryId: matchedCat?.id ?? existing[0].categoryId,
          updatedAt: new Date(),
        })
        .where(eq(budgets.id, existing[0].id))
        .returning();
      return c.json({ ok: true, budget: updated });
    }

    const [created] = await db
      .insert(budgets)
      .values({
        category: canonicalName,
        categoryId: matchedCat?.id ?? null,
        period: parsed.data.period,
        limitAmount: parsed.data.limitAmount,
      })
      .returning();

    return c.json({ ok: true, budget: created }, 201);
  });

  router.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID budget tidak valid." }, 400);

    await db.delete(budgets).where(eq(budgets.id, id));
    return c.json({ ok: true });
  });

  return router;
}
