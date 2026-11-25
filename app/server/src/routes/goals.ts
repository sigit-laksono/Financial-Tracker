import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { EmergencyFundRunwayDto, GoalDto } from "../../../shared/src/dtos";
import {
  contributeGoalSchema,
  createGoalSchema,
  updateGoalSchema,
} from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { categories, goals, transactions, transactionSplits, wallets } from "../db/schema";
import { recordAuditLog } from "../lib/auditService";
import { addDaysToDate, jakartaToday } from "../lib/dates";
import { computeLedgerSnapshot, computeWalletBalance } from "../lib/ledger";
import { ValidationError } from "../lib/errors";
import { lockLedger } from "../lib/ledgerLock";

async function validateGoalWallet(db: AppDb, walletId: number | null | undefined) {
  if (walletId == null) return null;
  const [wallet] = await db
    .select({ id: wallets.id, type: wallets.type })
    .from(wallets)
    .where(eq(wallets.id, walletId))
    .limit(1);
  if (!wallet) {
    return { status: 404 as const, error: "Dompet target tidak ditemukan." };
  }
  if (wallet.type === "credit_card") {
    return {
      status: 400 as const,
      error: "Dompet target tabungan tidak boleh berupa kartu kredit.",
    };
  }
  return null;
}

export function createGoalRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const today = jakartaToday();
    const ninetyDaysAgo = addDaysToDate(today, -90);

    const [goalRows, snap, recentExpenses] = await Promise.all([
      db.select().from(goals).orderBy(desc(goals.isEmergencyFund), desc(goals.id)),
      computeLedgerSnapshot(db, today),
      db
        .select({
          id: transactions.id,
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
    ]);

    const expIds = recentExpenses.map((e) => e.id);
    const splitRows =
      expIds.length > 0
        ? await db
            .select({
              transactionId: transactionSplits.transactionId,
              category: transactionSplits.category,
              amount: transactionSplits.amount,
            })
            .from(transactionSplits)
            .where(inArray(transactionSplits.transactionId, expIds))
        : [];

    const splitsByTxId = new Map<number, typeof splitRows>();
    for (const sp of splitRows) {
      const list = splitsByTxId.get(sp.transactionId) ?? [];
      list.push(sp);
      splitsByTxId.set(sp.transactionId, list);
    }

    const walletMap = new Map(snap.wallets.map((w) => [w.id, w.name]));
    const needsCatSet = new Set(
      snap.categories
        .filter((cat) => cat.type === "expense" && cat.bucket === "needs")
        .map((cat) => cat.name.trim().toLowerCase()),
    );

    let needsExpenseSum = 0;
    for (const exp of recentExpenses) {
      const txSplits = splitsByTxId.get(exp.id);
      if (txSplits && txSplits.length > 0) {
        for (const sp of txSplits) {
          if (needsCatSet.has(sp.category.trim().toLowerCase())) {
            needsExpenseSum += sp.amount;
          }
        }
      } else if (needsCatSet.has(exp.category.trim().toLowerCase())) {
        needsExpenseSum += exp.amount;
      }
    }

    let monthlyNeedsBurnRate = Math.round(needsExpenseSum / 3);
    if (monthlyNeedsBurnRate === 0) {
      monthlyNeedsBurnRate =
        snap.settings.netSalary > 0 ? Math.round(snap.settings.netSalary * 0.5) : 3_000_000;
    }

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

    const emergencyGoals = goalRows.filter((g) => g.isEmergencyFund);
    let totalEmergencyFunds = emergencyGoals.reduce((sum, g) => sum + g.currentAmount, 0);

    // Fall back to live savings-wallet balance when no dedicated emergency goal has funds.
    if (totalEmergencyFunds === 0) {
      totalEmergencyFunds = Math.max(0, snap.totalSavingsCash);
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

    const walletError = await validateGoalWallet(db, parsed.data.walletId);
    if (walletError) {
      return c.json({ error: walletError.error }, walletError.status);
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

    const walletError = await validateGoalWallet(db, parsed.data.walletId);
    if (walletError) {
      return c.json({ error: walletError.error }, walletError.status);
    }

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

    const [targetWallet] = goal.walletId
      ? await db.select().from(wallets).where(eq(wallets.id, goal.walletId)).limit(1)
      : [null];
    if (targetWallet && targetWallet.type === "credit_card") {
      return c.json({ error: "Dompet tujuan target tabungan tidak boleh berupa kartu kredit." }, 400);
    }

    const hasTargetWallet = Boolean(targetWallet && targetWallet.id !== wallet.id);
    const txDate = parsed.data.date ?? jakartaToday();
    const amount = parsed.data.amount;

    const [tabunganCategory] = hasTargetWallet
      ? await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(eq(categories.type, "expense"), eq(categories.name, "Tabungan")))
          .limit(1)
      : [null];

    const result = await db.transaction(async (tx) => {
      await lockLedger(tx);

      if (parsed.data.preventOverdraft) {
        const curBalance = await computeWalletBalance(tx, wallet.id, wallet.openingBalance);
        if (curBalance < amount) {
          throw new ValidationError(
            `Saldo dompet ${wallet.name} tidak mencukupi untuk setoran tabungan (Saldo: Rp${curBalance.toLocaleString("id-ID")}, Setoran: Rp${amount.toLocaleString("id-ID")}).`,
          );
        }
      }

      let transactionId: number | null = null;

      if (hasTargetWallet) {
        // Record a transfer only when moving cash to a separate target wallet.
        const [txRow] = await tx
          .insert(transactions)
          .values({
            type: "transfer",
            merchant: `Setor Target: ${goal.name} ke ${targetWallet!.name}`,
            amount,
            transactionDate: txDate,
            category: tabunganCategory?.name ?? "Tabungan",
            categoryId: tabunganCategory?.id ?? null,
            walletId: wallet.id,
            toWalletId: targetWallet!.id,
            note: parsed.data.note?.trim() || `Setor dana ke target tabungan ${goal.name}`,
            source: "manual",
            sourceRef: `goal:${goal.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          })
          .returning({ id: transactions.id });
        transactionId = txRow!.id;
      }

      const [updatedGoal] = await tx
        .update(goals)
        .set({
          currentAmount: sql`${goals.currentAmount} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, id))
        .returning();

      if (!hasTargetWallet) {
        // Earmarking inside the same/unlinked wallet preserves cash balance and net worth.
        await recordAuditLog(tx, {
          entityType: "goal",
          entityId: goal.id,
          action: "goal_contribute_earmark",
          before: { currentAmount: goal.currentAmount },
          after: {
            currentAmount: updatedGoal!.currentAmount,
            amount,
            walletId: wallet.id,
            date: txDate,
            note: parsed.data.note?.trim() || null,
          },
        });
      }

      return { transactionId, goal: updatedGoal };
    });

    return c.json({ ok: true, ...result });
  });

  return router;
}
