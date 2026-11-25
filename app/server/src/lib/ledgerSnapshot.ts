import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { AppDb } from "../db";
import {
  appSettings,
  budgets,
  categories,
  debtAccounts,
  installments,
  settlementAllocations,
  transactions,
  wallets,
} from "../db/schema";
import { ensureMonthlyBankFees } from "./ccBilling";
import { ccCycleForDate, jakartaToday, shiftMonth } from "./dates";
import { ensurePayrollAutoPaid, filterActiveInstallmentIds } from "./debtEngine";
import { remainingPrincipal } from "./debtTarget";
import { getSettings } from "./settingsService";

export async function runDailyLedgerSync(
  db: AppDb,
  today = jakartaToday(),
  options: { force?: boolean; extraCcCycles?: string[] } = {},
): Promise<{ synced: boolean; feesInserted: number; payrollSettled: number }> {
  const settings = await getSettings(db);
  const activeCcWallets = await db
    .select({ cutoffDay: wallets.cutoffDay })
    .from(wallets)
    .where(and(eq(wallets.type, "credit_card"), eq(wallets.isActive, true)));

  const currentCcCycles = new Set<string>([ccCycleForDate(today, settings.cardCutoffDay)]);
  for (const w of activeCcWallets) {
    currentCcCycles.add(ccCycleForDate(today, w.cutoffDay ?? settings.cardCutoffDay));
  }
  const maxCurrentCcCycle = [...currentCcCycles].sort().pop() ?? ccCycleForDate(today, settings.cardCutoffDay);
  const extraValid = (options.extraCcCycles ?? []).filter(
    (cycleKey) => cycleKey <= maxCurrentCcCycle,
  );

  if (!options.force && extraValid.length === 0 && settings.lastAutoSyncDate === today) {
    return { synced: false, feesInserted: 0, payrollSettled: 0 };
  }

  const directCycles = new Set<string>([...currentCcCycles, ...extraValid]);
  const prevLookbackCycles = new Set<string>();
  for (const c of currentCcCycles) {
    const prev = shiftMonth(c, -1);
    if (!directCycles.has(prev)) {
      prevLookbackCycles.add(prev);
    }
  }

  let feesInserted = 0;
  for (const cycleKey of directCycles) {
    feesInserted += await ensureMonthlyBankFees(db, cycleKey);
  }
  for (const cycleKey of prevLookbackCycles) {
    feesInserted += await ensureMonthlyBankFees(db, cycleKey, {
      requireActivityForWallets: true,
    });
  }
  const payrollSettled = await ensurePayrollAutoPaid(db, today);

  if (settings.lastAutoSyncDate !== today) {
    await db
      .update(appSettings)
      .set({ lastAutoSyncDate: today, updatedAt: new Date() })
      .where(eq(appSettings.id, 1));
  }

  return { synced: true, feesInserted, payrollSettled };
}

export async function computeLedgerSnapshot(db: AppDb, today = jakartaToday()) {
  const settings = await getSettings(db);
  const currentCcCycle = ccCycleForDate(today, settings.cardCutoffDay);

  const [
    walletRows,
    walletTypeAgg,
    transferInAgg,
    accountRows,
    installmentRows,
    categoryRows,
    budgetRows,
    ccSettledAgg,
    ccSettlementCycles,
  ] = await Promise.all([
    db.select().from(wallets).orderBy(asc(wallets.sortOrder), asc(wallets.id)),
    db
      .select({
        walletId: transactions.walletId,
        type: transactions.type,
        total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .groupBy(transactions.walletId, transactions.type),
    db
      .select({
        toWalletId: transactions.toWalletId,
        total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.type, "transfer"), isNotNull(transactions.toWalletId)))
      .groupBy(transactions.toWalletId),
    db.select().from(debtAccounts).orderBy(asc(debtAccounts.id)),
    db.select().from(installments).orderBy(asc(installments.dueDate), asc(installments.id)),
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id)),
    db.select().from(budgets),
    db
      .select({
        ccWalletId: settlementAllocations.ccWalletId,
        ccCycleKey: settlementAllocations.ccCycleKey,
        total: sql<number>`COALESCE(SUM(${settlementAllocations.allocatedAmount}), 0)`,
      })
      .from(settlementAllocations)
      .where(
        and(
          eq(settlementAllocations.targetType, "cc_cycle"),
          isNotNull(settlementAllocations.ccCycleKey),
        ),
      )
      .groupBy(settlementAllocations.ccWalletId, settlementAllocations.ccCycleKey),
    db
      .selectDistinct({
        walletId: transactions.toWalletId,
        ccCycleKey: transactions.ccCycleKey,
      })
      .from(transactions)
      .where(and(eq(transactions.type, "settlement"), isNotNull(transactions.ccCycleKey))),
  ]);

  const activeInstallmentIds = filterActiveInstallmentIds(accountRows, installmentRows);
  const activeInstallments = installmentRows.filter((row) => activeInstallmentIds.has(row.id));

  const ccWallets = walletRows.filter((w) => w.type === "credit_card");
  const ccWalletIds = ccWallets.map((w) => w.id);

  const ccSpendAgg =
    ccWalletIds.length > 0
      ? await db
          .select({
            walletId: transactions.walletId,
            ccCycleKey: transactions.ccCycleKey,
            total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.walletId, ccWalletIds),
              eq(transactions.type, "expense"),
              eq(transactions.isConvertedToInstallment, false),
              isNotNull(transactions.ccCycleKey),
            ),
          )
          .groupBy(transactions.walletId, transactions.ccCycleKey)
      : [];

  // Map: `${walletId}:${cycleKey}` -> settled amount; null walletId tracked separately for single-CC fallback
  const settledDailyByWalletAndCycle = new Map<string, number>();
  const settledNullWalletByCycle = new Map<string, number>();
  const settledDailyByCycle = new Map<string, number>();
  for (const row of ccSettledAgg) {
    if (row.ccCycleKey) {
      const amt = Number(row.total ?? 0);
      if (row.ccWalletId) {
        const key = `${row.ccWalletId}:${row.ccCycleKey}`;
        settledDailyByWalletAndCycle.set(key, (settledDailyByWalletAndCycle.get(key) ?? 0) + amt);
      } else {
        settledNullWalletByCycle.set(
          row.ccCycleKey,
          (settledNullWalletByCycle.get(row.ccCycleKey) ?? 0) + amt,
        );
      }
      const existingCycleTotal = settledDailyByCycle.get(row.ccCycleKey) ?? 0;
      settledDailyByCycle.set(row.ccCycleKey, existingCycleTotal + amt);
    }
  }

  const settledCcCycles = new Set<string>();
  for (const row of ccSettlementCycles) {
    if (row.ccCycleKey) settledCcCycles.add(row.ccCycleKey);
  }

  const nonCcBalances = new Map<number, number>();
  for (const w of walletRows) {
    if (w.type !== "credit_card") {
      nonCcBalances.set(w.id, w.openingBalance);
    }
  }

  for (const row of walletTypeAgg) {
    const cur = nonCcBalances.get(row.walletId);
    if (cur === undefined) continue;
    const total = Number(row.total ?? 0);
    if (
      row.type === "income" ||
      row.type === "debt_collection" ||
      row.type === "loan_disbursement"
    ) {
      nonCcBalances.set(row.walletId, cur + total);
    } else if (row.type === "adjustment") {
      nonCcBalances.set(row.walletId, cur + total);
    } else if (
      row.type === "expense" ||
      row.type === "settlement" ||
      row.type === "transfer" ||
      row.type === "debt_disbursement"
    ) {
      nonCcBalances.set(row.walletId, cur - total);
    }
  }

  for (const row of transferInAgg) {
    if (!row.toWalletId) continue;
    const cur = nonCcBalances.get(row.toWalletId);
    if (cur !== undefined) {
      nonCcBalances.set(row.toWalletId, cur + Number(row.total ?? 0));
    }
  }

  const enrichedAccounts = accountRows.map((account) => {
    const rows = activeInstallments.filter((i) => i.accountId === account.id);
    const paidAmount = rows
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + (i.actualAmount ?? i.plannedAmount), 0);
    const accountRowsAll = installmentRows.filter((i) => i.accountId === account.id);
    const closed = account.closedAt != null;
    // A closed account owes nothing, even if it was settled early at a discount.
    const remainingBalance = closed ? 0 : remainingPrincipal(account.initialBalance, accountRowsAll);
    return {
      ...account,
      direction: account.direction ?? "payable",
      disburseWalletId: account.disburseWalletId ?? null,
      disbursedAt: account.disbursedAt ?? null,
      interestRateBps: account.interestRateBps ?? null,
      paidAmount,
      remainingBalance,
      totalInstallments: rows.length,
      paidInstallments: rows.filter((i) => i.status === "paid").length,
      closed,
    };
  });

  // Map: walletId -> (Map: cycleKey -> spend)
  const ccSpendByWalletAndCycle = new Map<number, Map<string, number>>();
  const ccSpendByCycle = new Map<string, number>();

  for (const row of ccSpendAgg) {
    if (row.ccCycleKey && row.walletId) {
      const amt = Number(row.total ?? 0);
      let wMap = ccSpendByWalletAndCycle.get(row.walletId);
      if (!wMap) {
        wMap = new Map();
        ccSpendByWalletAndCycle.set(row.walletId, wMap);
      }
      wMap.set(row.ccCycleKey, amt);

      const curCycleTotal = ccSpendByCycle.get(row.ccCycleKey) ?? 0;
      ccSpendByCycle.set(row.ccCycleKey, curCycleTotal + amt);
    }
  }

  const legacySettledBeforeCycle = settings.legacySettledBeforeCycle;

  const unpaidCcDailyForWalletAndCycle = (walletId: number, cycleKey: string): number => {
    if (legacySettledBeforeCycle && cycleKey <= legacySettledBeforeCycle) return 0;
    const spend = ccSpendByWalletAndCycle.get(walletId)?.get(cycleKey) ?? 0;
    const directSettled = settledDailyByWalletAndCycle.get(`${walletId}:${cycleKey}`) ?? 0;
    const nullSettled =
      ccWallets.length <= 1 ? (settledNullWalletByCycle.get(cycleKey) ?? 0) : 0;
    return Math.max(0, spend - (directSettled + nullSettled));
  };

  const isCycleSettledForWallet = (walletId: number, cycleKey: string): boolean => {
    if (legacySettledBeforeCycle && cycleKey <= legacySettledBeforeCycle) return true;
    const spend = ccSpendByWalletAndCycle.get(walletId)?.get(cycleKey) ?? 0;
    if (spend === 0) return true;
    return unpaidCcDailyForWalletAndCycle(walletId, cycleKey) <= 0;
  };

  const isCycleSettled = (cycleKey: string): boolean => {
    if (legacySettledBeforeCycle && cycleKey <= legacySettledBeforeCycle) return true;
    const spend = ccSpendByCycle.get(cycleKey) ?? 0;
    if (spend === 0) return settledCcCycles.has(cycleKey);
    return (settledDailyByCycle.get(cycleKey) ?? 0) >= spend;
  };

  const unpaidCcDailyForCycle = (cycleKey: string): number => {
    if (legacySettledBeforeCycle && cycleKey <= legacySettledBeforeCycle) return 0;
    let total = 0;
    for (const cc of ccWallets) {
      total += unpaidCcDailyForWalletAndCycle(cc.id, cycleKey);
    }
    return total;
  };

  let unpaidCcDailyTotal = 0;
  for (const cc of ccWallets) {
    const wMap = ccSpendByWalletAndCycle.get(cc.id);
    if (!wMap) continue;
    for (const cycleKey of wMap.keys()) {
      unpaidCcDailyTotal += unpaidCcDailyForWalletAndCycle(cc.id, cycleKey);
    }
  }

  const cardInstallmentRemaining = enrichedAccounts
    .filter((a) => a.kind === "card_installment" && !a.closed)
    .reduce((sum, a) => sum + a.remainingBalance, 0);

  const walletBalances = walletRows.map((w) => {
    if (w.type === "credit_card") {
      const limit = w.creditLimit ?? settings.cardLimit;
      const wMap = ccSpendByWalletAndCycle.get(w.id);
      const wCycles = wMap ? [...wMap.keys()] : [];

      const wUnpaidDaily = wCycles.reduce(
        (sum, cycleKey) => sum + unpaidCcDailyForWalletAndCycle(w.id, cycleKey),
        0,
      );

      // Card installments belonging to this card (or all if only one card)
      const wCardInstallmentRemaining = enrichedAccounts
        .filter(
          (a) =>
            a.kind === "card_installment" &&
            !a.closed &&
            (a.walletId === w.id || (ccWallets.length === 1 && !a.walletId)),
        )
        .reduce((sum, a) => sum + a.remainingBalance, 0);

      const used = wUnpaidDaily + wCardInstallmentRemaining;
      const cardCurrentCycle = ccCycleForDate(today, w.cutoffDay ?? settings.cardCutoffDay);
      const curSpend = wMap?.get(cardCurrentCycle) ?? 0;

      return {
        ...w,
        balance: Math.max(0, limit - used),
        limitUsed: used,
        dailyLimitUsed: wUnpaidDaily,
        installmentLimitUsed: wCardInstallmentRemaining,
        creditLimit: limit,
        currentCycleSpend: curSpend,
      };
    }
    return {
      ...w,
      balance: nonCcBalances.get(w.id) ?? w.openingBalance,
      limitUsed: 0,
      dailyLimitUsed: 0,
      installmentLimitUsed: 0,
      currentCycleSpend: 0,
    };
  });

  const totalLiquidCash = walletBalances
    .filter((w) => w.isActive && w.type !== "credit_card")
    .reduce((sum, w) => sum + w.balance, 0);

  const totalSpendableCash = walletBalances
    .filter((w) => w.isActive && w.role === "spending")
    .reduce((sum, w) => sum + w.balance, 0);

  const totalSavingsCash = walletBalances
    .filter((w) => w.isActive && w.role === "savings")
    .reduce((sum, w) => sum + w.balance, 0);

  const unpaidCcDailyTotalAllCycles = unpaidCcDailyTotal;

  const enrichedCcWallets = walletBalances.filter(
    (w) => w.type === "credit_card" && (w.isActive || w.limitUsed > 0),
  );
  const enrichedPrimaryCc = enrichedCcWallets[0] ?? null;

  return {
    today,
    settings,
    currentCcCycle,
    ccWallet: enrichedPrimaryCc,
    ccWallets: enrichedCcWallets,
    wallets: walletBalances,
    accounts: enrichedAccounts,
    activeInstallments,
    categories: categoryRows,
    budgets: budgetRows,
    settledCcCycles,
    isCycleSettled,
    isCycleSettledForWallet,
    unpaidCcDailyForCycle,
    unpaidCcDailyForWalletAndCycle,
    ccSpendByCycle,
    ccSpendByWalletAndCycle,
    totalLiquidCash,
    totalSpendableCash,
    totalSavingsCash,
    unpaidCcDailyTotal,
    unpaidCcDailyTotalAllCycles,
    cardInstallmentRemaining,
  };
}
