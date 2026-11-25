import type { BudgetItemDto, BudgetStatus } from "../../../shared/src/dtos";
import type { budgets } from "../db/schema";

export function resolveBudgetsForPeriod(
  budgetRows: Array<typeof budgets.$inferSelect>,
  period: string,
  spentByCategory: Map<string, number>,
  periodEnd: string,
  today: string,
  periodStart?: string,
): BudgetItemDto[] {
  const defaultMap = new Map<string, typeof budgets.$inferSelect>();
  const overrideMap = new Map<string, typeof budgets.$inferSelect>();
  for (const row of budgetRows) {
    if (row.period === "default") defaultMap.set(row.category, row);
    else if (row.period === period) overrideMap.set(row.category, row);
  }

  const allCats = new Set([...defaultMap.keys(), ...overrideMap.keys()]);
  const endMs = new Date(`${periodEnd}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();

  let daysRemaining: number;
  if (today > periodEnd) {
    daysRemaining = 0;
  } else if (periodStart && today < periodStart) {
    const startMs = new Date(`${periodStart}T00:00:00Z`).getTime();
    daysRemaining = Math.max(1, Math.floor((endMs - startMs) / 86_400_000) + 1);
  } else {
    daysRemaining = Math.max(1, Math.floor((endMs - todayMs) / 86_400_000) + 1);
  }

  return [...allCats]
    .map((category): BudgetItemDto | null => {
      const override = overrideMap.get(category) ?? null;
      const base = defaultMap.get(category) ?? null;
      const effective = override ?? base;
      if (!effective) return null;

      const spentAmount = spentByCategory.get(category) ?? 0;
      const remainingAmount = effective.limitAmount - spentAmount;
      const percentUsed =
        effective.limitAmount > 0 ? Math.round((spentAmount / effective.limitAmount) * 100) : 0;
      // Compare exact amounts, not the rounded percentage: 995rb of 1jt rounds to 100% but is
      // not over budget yet.
      const status: BudgetStatus =
        effective.limitAmount > 0 && spentAmount > effective.limitAmount
          ? "over"
          : effective.limitAmount > 0 && spentAmount >= effective.limitAmount * 0.8
            ? "warning"
            : "ok";

      return {
        id: effective.id,
        category,
        period: effective.period,
        effectivePeriod: effective.period,
        isOverride: Boolean(override),
        templateId: base?.id ?? null,
        templateLimit: base?.limitAmount ?? null,
        limitAmount: effective.limitAmount,
        spentAmount,
        remainingAmount,
        percentUsed,
        dailyAllowanceRemaining:
          daysRemaining > 0 && remainingAmount > 0 ? Math.floor(remainingAmount / daysRemaining) : 0,
        status,
      };
    })
    .filter((item): item is BudgetItemDto => item !== null)
    .sort((a, b) => b.percentUsed - a.percentUsed);
}
