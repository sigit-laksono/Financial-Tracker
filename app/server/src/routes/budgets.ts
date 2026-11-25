import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import type { BudgetCategorySummary, BudgetOverviewDto } from "../../../shared/src/dtos";
import { upsertBudgetSchema } from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { budgets, categories, transactionSplits, transactions } from "../db/schema";
import { resolveBudgetsForPeriod } from "../lib/budgetService";
import { isValidYearMonth, jakartaToday, periodBounds, periodForDate, shiftMonth } from "../lib/dates";
import { computeLedgerSnapshot } from "../lib/ledgerSnapshot";
import { getSettings } from "../lib/settingsService";
import {
  computeSettlementExpenseAmount,
  getCcCycleAllocatedByTxId,
  resolveDebtExpenseCategoryName,
} from "../lib/settlementExpense";

async function computeSpentByCategoryInBounds(
  db: AppDb,
  start: string,
  end: string,
  categoryRows: Array<{ name: string; type: string }>,
): Promise<Map<string, number>> {
  const txRows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      category: transactions.category,
      amount: transactions.amount,
      ccCycleKey: transactions.ccCycleKey,
      installmentId: transactions.installmentId,
    })
    .from(transactions)
    .where(
      and(
        or(
          and(eq(transactions.type, "expense"), eq(transactions.isConvertedToInstallment, false)),
          eq(transactions.type, "settlement"),
        ),
        gte(transactions.transactionDate, start),
        lte(transactions.transactionDate, end),
      ),
    );

  const expenseIds = txRows.filter((r) => r.type === "expense").map((r) => r.id);
  const settlementIds = txRows.filter((r) => r.type === "settlement").map((r) => r.id);

  const [splitRows, ccCycleAllocatedByTxId] = await Promise.all([
    expenseIds.length > 0
      ? db
          .select()
          .from(transactionSplits)
          .where(inArray(transactionSplits.transactionId, expenseIds))
      : [],
    getCcCycleAllocatedByTxId(db, settlementIds),
  ]);

  const splitsByTxId = new Map<number, typeof splitRows>();
  for (const s of splitRows) {
    const arr = splitsByTxId.get(s.transactionId) ?? [];
    arr.push(s);
    splitsByTxId.set(s.transactionId, arr);
  }

  const spentByCategory = new Map<string, number>();
  for (const r of txRows) {
    if (r.type === "settlement") {
      const instAmt = computeSettlementExpenseAmount(r, ccCycleAllocatedByTxId);
      if (instAmt > 0) {
        const resolvedCat = resolveDebtExpenseCategoryName(r.category, categoryRows);
        spentByCategory.set(resolvedCat, (spentByCategory.get(resolvedCat) ?? 0) + instAmt);
      }
      continue;
    }

    const splits = splitsByTxId.get(r.id);
    if (splits && splits.length > 0) {
      for (const s of splits) {
        spentByCategory.set(s.category, (spentByCategory.get(s.category) ?? 0) + s.amount);
      }
    } else {
      spentByCategory.set(r.category, (spentByCategory.get(r.category) ?? 0) + r.amount);
    }
  }
  return spentByCategory;
}

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

    const [budgetRows, categoryRows] = await Promise.all([
      db.select().from(budgets),
      db.select({ name: categories.name, type: categories.type }).from(categories),
    ]);

    const spentByCategory = await computeSpentByCategoryInBounds(
      db,
      bounds.start,
      bounds.end,
      categoryRows,
    );

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
    const currentPeriod = periodForDate(
      today,
      "gajian",
      settings.gajianStartDay,
      settings.cardCutoffDay,
    );
    const requestedPeriod = queryPeriod ?? currentPeriod;
    const bounds = periodBounds(
      requestedPeriod,
      "gajian",
      settings.gajianStartDay,
      settings.cardCutoffDay,
    );

    const [budgetRows, categoryRows, distinctDates, snap] = await Promise.all([
      db.select().from(budgets),
      db.select().from(categories).where(eq(categories.isArchived, false)),
      db.selectDistinct({ transactionDate: transactions.transactionDate }).from(transactions),
      computeLedgerSnapshot(db, today),
    ]);

    const spentByCategory = await computeSpentByCategoryInBounds(
      db,
      bounds.start,
      bounds.end,
      categoryRows,
    );

    const availablePeriodSet = new Set<string>([
      currentPeriod,
      shiftMonth(currentPeriod, -1),
      shiftMonth(currentPeriod, 1),
      requestedPeriod,
      ...distinctDates.map((d) =>
        periodForDate(d.transactionDate, "gajian", settings.gajianStartDay, settings.cardCutoffDay),
      ),
      ...budgetRows.map((b) => b.period).filter((p) => p !== "default"),
    ]);
    const availablePeriods = [...availablePeriodSet].sort((a, b) => b.localeCompare(a));

    const totalLiquidCash = snap.totalLiquidCash;
    const isCurrentPeriod = requestedPeriod === currentPeriod;

    const defaultMap = new Map<string, typeof budgets.$inferSelect>();
    const overrideMap = new Map<string, typeof budgets.$inferSelect>();
    for (const b of budgetRows) {
      if (b.period === "default") defaultMap.set(b.category.toLowerCase(), b);
      else if (b.period === requestedPeriod) overrideMap.set(b.category.toLowerCase(), b);
    }

    const spentMap = new Map<string, number>();
    for (const [catName, amt] of spentByCategory.entries()) {
      const k = catName.toLowerCase();
      spentMap.set(k, (spentMap.get(k) ?? 0) + amt);
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

    // Per-cycle custom bucket allocations (strictly scoped to requestedPeriod so each cycle is independent)
    const needsBucketBudget = overrideMap.get("bucket:needs");
    const wantsBucketBudget = overrideMap.get("bucket:wants");
    const savingsBucketBudget = overrideMap.get("bucket:savings");

    const needsSubAllocated = needsCats.reduce(
      (sum, c) => sum + (overrideMap.get(c.categoryName.toLowerCase())?.limitAmount ?? 0),
      0,
    );
    const wantsSubAllocated = wantsCats.reduce(
      (sum, c) => sum + (overrideMap.get(c.categoryName.toLowerCase())?.limitAmount ?? 0),
      0,
    );
    const savingsSubAllocated = savingsCats.reduce(
      (sum, c) => sum + (overrideMap.get(c.categoryName.toLowerCase())?.limitAmount ?? 0),
      0,
    );

    const needsAllocated = needsBucketBudget ? needsBucketBudget.limitAmount : needsSubAllocated;
    const wantsAllocated = wantsBucketBudget ? wantsBucketBudget.limitAmount : wantsSubAllocated;
    const savingsAllocated = savingsBucketBudget ? savingsBucketBudget.limitAmount : savingsSubAllocated;
    const totalAllocated = needsAllocated + wantsAllocated + savingsAllocated;

    const needsSpent = needsCats.reduce((sum, c) => sum + c.actualSpent, 0);
    const wantsSpent = wantsCats.reduce((sum, c) => sum + c.actualSpent, 0);
    const savingsSpent = savingsCats.reduce((sum, c) => sum + c.actualSpent, 0);

    const needsRemaining = needsAllocated > 0 ? Math.max(0, needsAllocated - needsSpent) : 0;
    const wantsRemaining = wantsAllocated > 0 ? Math.max(0, wantsAllocated - wantsSpent) : 0;
    const savingsRemaining = savingsAllocated > 0 ? Math.max(0, savingsAllocated - savingsSpent) : 0;
    const totalRemainingAllocated = needsRemaining + wantsRemaining + savingsRemaining;

    const baselineFund = totalLiquidCash;
    const usedForShare = isCurrentPeriod ? totalRemainingAllocated : totalAllocated;
    const unallocated = baselineFund - usedForShare;

    const pctOfBaseline = (amount: number) =>
      baselineFund > 0 ? Math.round((amount / baselineFund) * 100) : 0;

    const summary: BudgetOverviewDto = {
      period: requestedPeriod,
      isCurrentPeriod,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      availablePeriods,
      estimatedIncome: baselineFund,
      totalLiquidCash,
      totalRemainingAllocated,
      totalAllocated,
      unallocated,
      needs: {
        idealPercent: 50,
        allocated: needsAllocated,
        remaining: needsRemaining,
        allocatedPercent: pctOfBaseline(isCurrentPeriod ? needsRemaining : needsAllocated),
        spent: needsSpent,
        categories: needsCats,
      },
      wants: {
        idealPercent: 30,
        allocated: wantsAllocated,
        remaining: wantsRemaining,
        allocatedPercent: pctOfBaseline(isCurrentPeriod ? wantsRemaining : wantsAllocated),
        spent: wantsSpent,
        categories: wantsCats,
      },
      savings: {
        idealPercent: 20,
        allocated: savingsAllocated,
        remaining: savingsRemaining,
        allocatedPercent: pctOfBaseline(isCurrentPeriod ? savingsRemaining : savingsAllocated),
        spent: savingsSpent,
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
