import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { EmergencyFundRunwayDto, GoalDto } from "../../../shared/src/dtos";
import {
  contributeGoalSchema,
  createGoalSchema,
  updateGoalSchema,
} from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { categories, goals, transactions, wallets } from "../db/schema";
import { jakartaToday } from "../lib/dates";
import { computeWalletBalance } from "../lib/ledger";
import { getSettings } from "../lib/settingsService";

export function createGoalRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const today = jakartaToday();
    const [goalRows, walletRows, settings] = await Promise.all([
      db.select().from(goals).orderBy(desc(goals.isEmergencyFund), desc(goals.id)),
      db.select().from(wallets),
      getSettings(db),
    ]);

    const walletMap = new Map(walletRows.map((w) => [w.id, w.name]));

    // Calculate monthly needs burn rate from last 90 days expenses
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const [recentExpenses, categoryRows] = await Promise.all([
      db
        .select({
          amount: transactions.amount,
          category: transactions.category,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.type, "expense"),
            eq(transactions.isConvertedToInstallment, false),
            gte(transactions.transactionDate, ninetyDaysAgo),
          ),
        ),
      db.select({ name: categories.name, bucket: categories.bucket }).from(categories),
    ]);

    const needsCatSet = new Set(
      categoryRows.filter((cat) => cat.bucket === "needs").map((cat) => cat.name.toLowerCase()),
    );

    let needsExpenseSum = 0;
    for (const exp of recentExpenses) {
      if (needsCatSet.has(exp.category.trim().toLowerCase())) {
        needsExpenseSum += exp.amount;
      }
    }

    // Monthly needs burn rate: 90 days total / 3 (or fallback to 50% net salary or 3 million)
    let monthlyNeedsBurnRate = Math.round(needsExpenseSum / 3);
    if (monthlyNeedsBurnRate === 0) {
      monthlyNeedsBurnRate =
        settings.netSalary > 0 ? Math.round(settings.netSalary * 0.5) : 3_000_000;
    }

    // Map goal items
    const todayYearMonth = today.slice(0, 7);
    const items: GoalDto[] = goalRows.map((g) => {
      const remainingAmount = Math.max(0, g.targetAmount - g.currentAmount);
      const percentAchieved =
        g.targetAmount > 0
          ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100))
          : 0;

      let monthlyTargetSuggested: number | null = null;
      if (g.targetDate && remainingAmount > 0) {
        const targetYM = g.targetDate.slice(0, 7);
        const [tYear, tMonth] = targetYM.split("-").map(Number);
        const [cYear, cMonth] = todayYearMonth.split("-").map(Number);
        if (tYear && tMonth && cYear && cMonth) {
          const monthDiff = (tYear - cYear) * 12 + (tMonth - cMonth);
          const monthsLeft = Math.max(1, monthDiff);
          monthlyTargetSuggested = Math.ceil(remainingAmount / monthsLeft);
        }
      }

      return {
        id: g.id,
        name: g.name,
        emoji: g.emoji,
        targetAmount: g.targetAmount,
        currentAmount: g.currentAmount,
        targetDate: g.targetDate,
        isEmergencyFund: g.isEmergencyFund,
        walletId: g.walletId,
        walletName: g.walletId ? (walletMap.get(g.walletId) ?? null) : null,
        notes: g.notes,
        percentAchieved,
        remainingAmount,
        monthlyTargetSuggested,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      };
    });

    // Emergency fund calculations
    const emergencyGoals = goalRows.filter((g) => g.isEmergencyFund);
    let totalEmergencyFunds = emergencyGoals.reduce((sum, g) => sum + g.currentAmount, 0);

    // If no emergency fund goals have funds, check savings wallets
    if (totalEmergencyFunds === 0) {
      const savingsWallets = walletRows.filter((w) => w.role === "savings" && w.isActive);
      totalEmergencyFunds = savingsWallets.reduce((sum, w) => sum + w.openingBalance, 0);
    }

    const runwayMonths =
      monthlyNeedsBurnRate > 0
        ? Number((totalEmergencyFunds / monthlyNeedsBurnRate).toFixed(1))
        : 0;

    const runwayStatus: EmergencyFundRunwayDto["status"] =
      runwayMonths >= 6
        ? "excellent"
        : runwayMonths >= 3
          ? "good"
          : runwayMonths >= 1
            ? "warning"
            : "critical";

    const emergencyFund: EmergencyFundRunwayDto = {
      totalEmergencyFunds,
      monthlyNeedsBurnRate,
      runwayMonths,
      status: runwayStatus,
      recommendedMonthsMin: 3,
      recommendedMonthsMax: 6,
    };

    return c.json({ goals: items, emergencyFund });
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createGoalSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data target tabungan tidak valid." },
        400,
      );
    }

    const [created] = await db
      .insert(goals)
      .values({
        name: parsed.data.name,
        emoji: parsed.data.emoji ?? "🎯",
        targetAmount: parsed.data.targetAmount,
        currentAmount: parsed.data.currentAmount ?? 0,
        targetDate: parsed.data.targetDate ?? null,
        isEmergencyFund: parsed.data.isEmergencyFund ?? false,
        walletId: parsed.data.walletId ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    return c.json({ ok: true, goal: created }, 201);
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID goal tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = updateGoalSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data edit tidak valid." }, 400);
    }

    const [existing] = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    if (!existing) return c.json({ error: "Target tabungan tidak ditemukan." }, 404);

    const [updated] = await db
      .update(goals)
      .set({
        ...parsed.data,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, id))
      .returning();

    return c.json({ ok: true, goal: updated });
  });

  router.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID goal tidak valid." }, 400);

    await db.delete(goals).where(eq(goals.id, id));
    return c.json({ ok: true });
  });

  router.post("/:id/contribute", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID goal tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = contributeGoalSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data setoran tidak valid." }, 400);
    }

    const [goal] = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    if (!goal) return c.json({ error: "Target tabungan tidak ditemukan." }, 404);

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, parsed.data.walletId))
      .limit(1);
    if (!wallet) return c.json({ error: "Dompet sumber tidak ditemukan." }, 404);
    if (wallet.type === "credit_card") {
      return c.json({ error: "Tidak dapat menyetor tabungan menggunakan kartu kredit." }, 400);
    }

    if (parsed.data.preventOverdraft) {
      const curBalance = await computeWalletBalance(db, wallet.id, wallet.openingBalance);
      if (curBalance < parsed.data.amount) {
        return c.json(
          {
            error: `Saldo dompet ${wallet.name} tidak mencukupi untuk setoran tabungan (Saldo: Rp${curBalance.toLocaleString("id-ID")}, Setoran: Rp${parsed.data.amount.toLocaleString("id-ID")}).`,
          },
          400,
        );
      }
    }

    const [tabunganCategory] = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.type, "expense"), eq(categories.name, "Tabungan")))
      .limit(1);

    const [targetWallet] = goal.walletId
      ? await db.select().from(wallets).where(eq(wallets.id, goal.walletId)).limit(1)
      : [null];
    const hasTargetWallet = Boolean(targetWallet && targetWallet.id !== wallet.id);

    const txDate = parsed.data.date ?? jakartaToday();
    const amount = parsed.data.amount;

    const result = await db.transaction(async (tx) => {
      // 1. Record transaction (as transfer if a separate target savings wallet is defined)
      const [txRow] = await tx
        .insert(transactions)
        .values({
          type: hasTargetWallet ? "transfer" : "expense",
          merchant: hasTargetWallet
            ? `Setor Target: ${goal.name} ke ${targetWallet!.name}`
            : `Setor Target: ${goal.name}`,
          amount,
          transactionDate: txDate,
          category: tabunganCategory?.name ?? "Tabungan",
          categoryId: tabunganCategory?.id ?? null,
          walletId: wallet.id,
          toWalletId: hasTargetWallet ? targetWallet!.id : null,
          note: parsed.data.note?.trim() || `Setor dana ke target tabungan ${goal.name}`,
          source: "manual",
        })
        .returning({ id: transactions.id });

      // 2. Update goal currentAmount
      const [updatedGoal] = await tx
        .update(goals)
        .set({
          currentAmount: sql`${goals.currentAmount} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, id))
        .returning();

      return { transactionId: txRow!.id, goal: updatedGoal };
    });

    return c.json({ ok: true, ...result });
  });

  return router;
}
