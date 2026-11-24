import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { CycleTimelineNode, DashboardDto, DebtsDto } from "../../../shared/src/dtos";
import type { CycleMode } from "../../../shared/src/types";
import type { AppDb } from "../db";
import { recurringRules, transactionSplits, transactions } from "../db/schema";
import { resolveBudgetsForPeriod } from "./budgetService";
import {
  addDaysToDate,
  ccCycleForDate,
  ccDueDateForCycle,
  daysBetween,
  jakartaToday,
  periodBounds,
  periodForDate,
  shiftMonth,
} from "./dates";
import { computeLedgerSnapshot } from "./ledgerSnapshot";

function findDatesWithDayInBounds(dayNumber: number, start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  while (cur <= endDate) {
    const year = cur.getUTCFullYear();
    const month = cur.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const effectiveDay = Math.min(dayNumber, daysInMonth);
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(effectiveDay).padStart(2, "0")}`;
    if (iso >= start && iso <= end && !dates.includes(iso)) {
      dates.push(iso);
    }
    cur.setUTCMonth(cur.getUTCMonth() + 1);
    cur.setUTCDate(1);
  }
  return dates;
}

export function generateCycleTimeline(
  snap: Awaited<ReturnType<typeof computeLedgerSnapshot>>,
  bounds: { start: string; end: string },
  today: string,
  salaryReceived = false,
): CycleTimelineNode[] {
  const nodes: CycleTimelineNode[] = [];
  const activeAccountMap = new Map(snap.accounts.map((a) => [a.id, a]));

  // 1. Credit Cards: Cutoff, Statement, and Payment days
  for (const cc of snap.ccWallets) {
    const cutoffDay = cc.cutoffDay ?? snap.settings.cardCutoffDay;
    const stmtDay = cc.statementDay ?? snap.settings.statementDay;
    const payDay = cc.paymentDay ?? snap.settings.cardPaymentDay;

    // Cutoff
    for (const d of findDatesWithDayInBounds(cutoffDay, bounds.start, bounds.end)) {
      const cycleKey = d.slice(0, 7);
      const cycleSpend = snap.ccSpendByWalletAndCycle.get(cc.id)?.get(cycleKey) ?? 0;
      if (d < today && cycleSpend === 0 && cc.limitUsed === 0) continue;

      nodes.push({
        id: `cutoff-${cc.id}-${d}`,
        date: d,
        title: `Tutup Buku ${cc.name}`,
        category: "cc_cutoff",
        amount: null,
        status: d < today ? "done" : d === today ? "due_today" : "upcoming",
        walletId: cc.id,
        badge: `Tgl ${cutoffDay}`,
      });
    }

    // Statement
    for (const d of findDatesWithDayInBounds(stmtDay, bounds.start, bounds.end)) {
      const cycleKey = d.slice(0, 7);
      const cycleSpend = snap.ccSpendByWalletAndCycle.get(cc.id)?.get(cycleKey) ?? 0;
      if (d < today && cycleSpend === 0 && cc.limitUsed === 0) continue;

      nodes.push({
        id: `statement-${cc.id}-${d}`,
        date: d,
        title: `Tagihan Dicetak ${cc.name}`,
        category: "cc_statement",
        amount: null,
        status: d < today ? "done" : d === today ? "due_today" : "upcoming",
        walletId: cc.id,
        badge: `Tgl ${stmtDay}`,
      });
    }

    // Payment
    for (const d of findDatesWithDayInBounds(payDay, bounds.start, bounds.end)) {
      const cycleKey = payDay <= cutoffDay ? shiftMonth(d.slice(0, 7), -1) : d.slice(0, 7);
      const isSettled = snap.isCycleSettledForWallet(cc.id, cycleKey);
      const remainingBill = snap.unpaidCcDailyForWalletAndCycle(cc.id, cycleKey);
      const cycleSpend = snap.ccSpendByWalletAndCycle.get(cc.id)?.get(cycleKey) ?? 0;

      if (d < today && cycleSpend === 0 && remainingBill === 0) continue;

      let status: "done" | "due_today" | "upcoming" | "overdue" = "upcoming";
      if (d > today) {
        status = "upcoming";
      } else if (d === today) {
        status = remainingBill > 0 ? "due_today" : "done";
      } else {
        status = remainingBill > 0 ? "overdue" : "done";
      }

      nodes.push({
        id: `payment-${cc.id}-${d}`,
        date: d,
        title: `Jatuh Tempo ${cc.name}`,
        category: "cc_payment",
        amount: isSettled ? 0 : remainingBill,
        status,
        walletId: cc.id,
        badge: `Tgl ${payDay}`,
      });
    }
  }

  // 2. Gajian milestone
  for (const d of findDatesWithDayInBounds(
    snap.settings.gajianStartDay,
    bounds.start,
    bounds.end,
  )) {
    let status: "done" | "due_today" | "upcoming" | "overdue" = "upcoming";
    if (salaryReceived) {
      status = "done";
    } else if (d < today) {
      status = "overdue";
    } else if (d === today) {
      status = "due_today";
    }
    nodes.push({
      id: `gajian-${d}`,
      date: d,
      title: "Gajian & Bayar Kewajiban",
      category: "gajian",
      amount: snap.settings.netSalary > 0 ? snap.settings.netSalary : null,
      status,
      badge: `Tgl ${snap.settings.gajianStartDay}`,
    });
  }

  // 3. Installments (Payables & Receivables) in this period
  for (const inst of snap.activeInstallments) {
    if (inst.dueDate >= bounds.start && inst.dueDate <= bounds.end) {
      const acc = activeAccountMap.get(inst.accountId);
      if (!acc || acc.closed) continue;

      let status: "done" | "due_today" | "upcoming" | "overdue" = "upcoming";
      if (inst.status === "paid") {
        status = "done";
      } else if (inst.dueDate < today) {
        status = "overdue";
      } else if (inst.dueDate === today) {
        status = "due_today";
      }

      if (acc.direction === "receivable") {
        nodes.push({
          id: `receivable-${inst.id}`,
          date: inst.dueDate,
          title: `Tagih Piutang: ${acc.name}`,
          category: "receivable_due",
          amount: inst.plannedAmount,
          status,
          accountId: acc.id,
          installmentId: inst.id,
          badge: acc.lender || "Piutang",
        });
      } else {
        nodes.push({
          id: `debt-${inst.id}`,
          date: inst.dueDate,
          title: `Cicilan ${acc.name}`,
          category: "debt_due",
          amount: inst.plannedAmount,
          status,
          accountId: acc.id,
          installmentId: inst.id,
          badge: acc.lender,
        });
      }
    }
  }

  // Sort chronologically and by category priority
  const categoryOrder: Record<CycleTimelineNode["category"], number> = {
    cc_cutoff: 1,
    cc_statement: 2,
    debt_due: 3,
    receivable_due: 4,
    gajian: 5,
    cc_payment: 6,
  };

  nodes.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    return (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
  });

  return nodes;
}

export async function buildDashboardData(
  db: AppDb,
  params: { cycle?: CycleMode; period?: string; today?: string } = {},
): Promise<DashboardDto> {
  const today = params.today ?? jakartaToday();
  const snap = await computeLedgerSnapshot(db, today);
  const cycle: CycleMode = params.cycle ?? "gajian";
  const currentPeriod = periodForDate(
    today,
    cycle,
    snap.settings.gajianStartDay,
    snap.settings.cardCutoffDay,
  );
  const selectedPeriod = params.period ?? currentPeriod;

  const bounds = periodBounds(
    selectedPeriod,
    cycle,
    snap.settings.gajianStartDay,
    snap.settings.cardCutoffDay,
  );

  const currentMonthPrefix = today.slice(0, 7);
  const calYear = parseInt(today.slice(0, 4), 10);
  const calMonth = parseInt(today.slice(5, 7), 10);
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const monthStart = `${currentMonthPrefix}-01`;
  const monthEnd = `${currentMonthPrefix}-${daysInMonth < 10 ? `0${daysInMonth}` : daysInMonth}`;

  const [periodRows, distinctDateRows, recurringRuleRows, monthRows] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.transactionDate, bounds.start),
          lte(transactions.transactionDate, bounds.end),
        ),
      )
      .orderBy(desc(transactions.transactionDate), desc(transactions.id)),
    db.selectDistinct({ transactionDate: transactions.transactionDate }).from(transactions),
    db.select().from(recurringRules).where(eq(recurringRules.isActive, true)),
    db
      .select({
        transactionDate: transactions.transactionDate,
        type: transactions.type,
        amount: transactions.amount,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.transactionDate, monthStart),
          lte(transactions.transactionDate, monthEnd),
        ),
      ),
  ]);

  const periodTxIds = periodRows.map((tx) => tx.id);
  const transferGroupIds = periodRows
    .map((tx) => tx.transferGroupId)
    .filter((gid): gid is string => Boolean(gid));

  const [splitRows, feeRows] = await Promise.all([
    periodTxIds.length > 0
      ? db
          .select()
          .from(transactionSplits)
          .where(inArray(transactionSplits.transactionId, periodTxIds))
      : [],
    transferGroupIds.length > 0
      ? db
          .select()
          .from(transactions)
          .where(
            and(
              inArray(transactions.transferGroupId, transferGroupIds),
              eq(transactions.type, "expense"),
              eq(transactions.category, "Biaya Bank"),
            ),
          )
      : [],
  ]);

  const splitsByTxId = new Map<
    number,
    Array<{
      id: number;
      category: string;
      categoryId: number | null;
      amount: number;
      note: string | null;
    }>
  >();
  for (const s of splitRows) {
    const arr = splitsByTxId.get(s.transactionId) ?? [];
    arr.push({
      id: s.id,
      category: s.category,
      categoryId: s.categoryId,
      amount: s.amount,
      note: s.note,
    });
    splitsByTxId.set(s.transactionId, arr);
  }

  const feeByGroupId = new Map<string, { id: number; amount: number }>();
  for (const f of feeRows) {
    if (f.transferGroupId) {
      feeByGroupId.set(f.transferGroupId, { id: f.id, amount: f.amount });
    }
  }

  const availablePeriods = [
    ...new Set([
      selectedPeriod,
      ...distinctDateRows.map((d) =>
        periodForDate(
          d.transactionDate,
          cycle,
          snap.settings.gajianStartDay,
          snap.settings.cardCutoffDay,
        ),
      ),
    ]),
  ]
    .sort()
    .reverse();

  const walletById = new Map(snap.wallets.map((w) => [w.id, w]));
  const ccWalletIds = new Set(snap.ccWallets.map((w) => w.id));

  let totalIncome = 0;
  let totalExpense = 0;
  let totalCashOut = 0;
  let totalCcExpense = 0;
  let totalSettlement = 0;
  let totalTransfer = 0;

  const categoryMap = new Map<string, { total: number; count: number }>();
  const incomeCategoryMap = new Map<string, { total: number; count: number }>();
  const dailyMap = new Map<string, { income: number; expense: number }>();

  for (const tx of periodRows) {
    const day = dailyMap.get(tx.transactionDate) ?? { income: 0, expense: 0 };
    if (tx.type === "income") {
      totalIncome += tx.amount;
      day.income += tx.amount;
      const item = incomeCategoryMap.get(tx.category) ?? { total: 0, count: 0 };
      item.total += tx.amount;
      item.count += 1;
      incomeCategoryMap.set(tx.category, item);
    } else if (tx.type === "expense") {
      if (!tx.isConvertedToInstallment) {
        totalExpense += tx.amount;
        day.expense += tx.amount;
        if (ccWalletIds.has(tx.walletId)) {
          totalCcExpense += tx.amount;
        } else {
          totalCashOut += tx.amount;
        }

        const splits = splitsByTxId.get(tx.id);
        if (splits && splits.length > 0) {
          for (const s of splits) {
            const item = categoryMap.get(s.category) ?? { total: 0, count: 0 };
            item.total += s.amount;
            item.count += 1;
            categoryMap.set(s.category, item);
          }
        } else {
          const item = categoryMap.get(tx.category) ?? { total: 0, count: 0 };
          item.total += tx.amount;
          item.count += 1;
          categoryMap.set(tx.category, item);
        }
      }
    } else if (tx.type === "settlement") {
      totalSettlement += tx.amount;
      totalCashOut += tx.amount;
    } else if (tx.type === "transfer") {
      totalTransfer += tx.amount;
    }
    dailyMap.set(tx.transactionDate, day);
  }

  // Billed vs unbilled CC bridge inside a gajian cycle view.
  const ccWallets = snap.wallets.filter((w) => w.type === "credit_card");
  const unbilledStartByCcWalletId = new Map<number, string>();
  let primaryUnbilledStartKey: string | null = null;

  if (cycle === "gajian") {
    for (const card of ccWallets) {
      const cardCutoff = card.cutoffDay ?? snap.settings.cardCutoffDay;
      const endCcCycle = ccCycleForDate(bounds.end, cardCutoff);
      const endCcBounds = periodBounds(endCcCycle, "cc", snap.settings.gajianStartDay, cardCutoff);
      if (bounds.end < endCcBounds.end) {
        const startKey =
          endCcBounds.start.localeCompare(bounds.start) >= 0 ? endCcBounds.start : bounds.start;
        unbilledStartByCcWalletId.set(card.id, startKey);
        if (!primaryUnbilledStartKey) {
          primaryUnbilledStartKey = startKey;
        }
      }
    }
  }

  let ccUnbilled = 0;
  let ccUnbilledCount = 0;
  if (unbilledStartByCcWalletId.size > 0 && ccWalletIds.size > 0) {
    for (const tx of periodRows) {
      const startKey = unbilledStartByCcWalletId.get(tx.walletId);
      if (
        startKey &&
        tx.type === "expense" &&
        !tx.isConvertedToInstallment &&
        ccWalletIds.has(tx.walletId) &&
        tx.transactionDate >= startKey &&
        tx.transactionDate <= bounds.end
      ) {
        ccUnbilled += tx.amount;
        ccUnbilledCount += 1;
      }
    }
  }
  const ccBilled = totalCcExpense - ccUnbilled;

  // Obligations due on or before the end of the viewed period that remain unpaid.
  // Note: Only payable debts count as obligations (receivables are excluded).
  const activeAccountMap = new Map(snap.accounts.map((a) => [a.id, a]));
  const unpaidInstallmentsDue = snap.activeInstallments.filter((inst) => {
    const acc = activeAccountMap.get(inst.accountId);
    if (!acc || acc.closed || acc.kind === "payroll" || acc.direction === "receivable") {
      return false;
    }
    return inst.status === "upcoming" && inst.dueDate <= bounds.end;
  });
  const unpaidInstallmentsSum = unpaidInstallmentsDue.reduce(
    (sum, inst) => sum + inst.plannedAmount,
    0,
  );

  let unpaidCcCyclesSum = 0;
  let upcomingCcCyclesSum = 0;
  const unpaidCcCycles: Array<{
    walletId: number;
    walletName: string;
    cycleKey: string;
    dueDate: string;
    amount: number;
  }> = [];
  const upcomingCcCycles: Array<{
    walletId: number;
    walletName: string;
    cycleKey: string;
    dueDate: string;
    amount: number;
  }> = [];

  for (const cc of snap.ccWallets) {
    const cutoffDay = cc.cutoffDay ?? snap.settings.cardCutoffDay;
    const payDay = cc.paymentDay ?? snap.settings.cardPaymentDay;
    const wMap = snap.ccSpendByWalletAndCycle.get(cc.id);
    if (!wMap) continue;

    for (const cycleKey of wMap.keys()) {
      const remaining = snap.unpaidCcDailyForWalletAndCycle(cc.id, cycleKey);
      if (remaining <= 0) continue;
      const dueDate = ccDueDateForCycle(cycleKey, cutoffDay, payDay);
      if (dueDate <= bounds.end) {
        unpaidCcCyclesSum += remaining;
        unpaidCcCycles.push({
          walletId: cc.id,
          walletName: cc.name,
          cycleKey,
          dueDate,
          amount: remaining,
        });
      } else {
        upcomingCcCyclesSum += remaining;
        upcomingCcCycles.push({
          walletId: cc.id,
          walletName: cc.name,
          cycleKey,
          dueDate,
          amount: remaining,
        });
      }
    }
  }

  if (snap.ccWallets.length === 0 && snap.ccSpendByCycle.size > 0) {
    for (const cycleKey of snap.ccSpendByCycle.keys()) {
      const remaining = snap.unpaidCcDailyForCycle(cycleKey);
      if (remaining <= 0) continue;
      const dueDate = ccDueDateForCycle(
        cycleKey,
        snap.settings.cardCutoffDay,
        snap.settings.cardPaymentDay,
      );
      if (dueDate <= bounds.end) {
        unpaidCcCyclesSum += remaining;
        unpaidCcCycles.push({
          walletId: 0,
          walletName: "Credit Card",
          cycleKey,
          dueDate,
          amount: remaining,
        });
      } else {
        upcomingCcCyclesSum += remaining;
        upcomingCcCycles.push({
          walletId: 0,
          walletName: "Credit Card",
          cycleKey,
          dueDate,
          amount: remaining,
        });
      }
    }
  }

  let unpaidRecurringSum = 0;
  const recurringBills = recurringRuleRows.map((r) => {
    const isPaidThisCycle =
      r.lastPaidPeriod === selectedPeriod ||
      periodRows.some((tx) => tx.sourceRef === `recurring-${r.id}-${selectedPeriod}`);
    const dueDates = findDatesWithDayInBounds(r.dueDay, bounds.start, bounds.end);
    const dueDateThisCycle =
      dueDates[0] ?? `${selectedPeriod}-${String(r.dueDay).padStart(2, "0")}`;
    if (!isPaidThisCycle) {
      unpaidRecurringSum += r.amount;
    }
    return {
      id: r.id,
      merchant: r.merchant,
      amount: r.amount,
      category: r.category,
      categoryId: r.categoryId,
      walletId: r.walletId,
      walletName: walletById.get(r.walletId)?.name ?? "Dompet",
      dueDay: r.dueDay,
      isActive: r.isActive,
      lastPaidPeriod: r.lastPaidPeriod,
      createdAt: r.createdAt.toISOString(),
      isPaidThisCycle,
      dueDateThisCycle,
    };
  });

  const remainingObligations = unpaidInstallmentsSum + unpaidCcCyclesSum + unpaidRecurringSum;
  const ccReservedCash = unpaidCcCyclesSum;
  const safeToSpend =
    snap.totalSpendableCash - remainingObligations;

  // Cycle pacing & days calculation
  const daysTotal = Math.max(1, daysBetween(bounds.start, bounds.end) + 1);
  let daysElapsed = 0;
  let daysRemaining = daysTotal;
  let timeProgressPercent = 0;

  if (today < bounds.start) {
    daysElapsed = 0;
    daysRemaining = daysTotal;
    timeProgressPercent = 0;
  } else if (today > bounds.end) {
    daysElapsed = daysTotal;
    daysRemaining = 0;
    timeProgressPercent = 100;
  } else {
    daysElapsed = daysBetween(bounds.start, today) + 1;
    daysRemaining = Math.max(1, daysBetween(today, bounds.end) + 1);
    timeProgressPercent = Math.min(100, Math.max(0, Math.round((daysElapsed / daysTotal) * 100)));
  }

  const cycleRemaining = Math.max(0, safeToSpend);
  const dailyAllowance = daysRemaining > 0 ? Math.floor(cycleRemaining / daysRemaining) : 0;

  // Discretionary vs mandatory expense
  const mandatoryCategoryNames = new Set(
    snap.categories.filter((c) => c.isMandatory).map((c) => c.name),
  );
  let discretionarySpent = 0;
  for (const tx of periodRows) {
    if (tx.type === "expense" && !tx.isConvertedToInstallment) {
      const splits = splitsByTxId.get(tx.id);
      if (splits && splits.length > 0) {
        for (const s of splits) {
          if (!mandatoryCategoryNames.has(s.category)) {
            discretionarySpent += s.amount;
          }
        }
      } else {
        if (!mandatoryCategoryNames.has(tx.category)) {
          discretionarySpent += tx.amount;
        }
      }
    }
  }

  // Pacing status evaluation
  const discretionaryCapacity = discretionarySpent + cycleRemaining;
  let pacingStatus: "hemat" | "sesuai_jalur" | "agak_boros" | "overpace" = "sesuai_jalur";
  if (safeToSpend <= 0 && daysRemaining > 0) {
    pacingStatus = "overpace";
  } else if (discretionaryCapacity > 0) {
    const discretionaryPercent = Math.round((discretionarySpent / discretionaryCapacity) * 100);
    const delta = discretionaryPercent - timeProgressPercent;
    if (delta < -10) {
      pacingStatus = "hemat";
    } else if (delta <= 5) {
      pacingStatus = "sesuai_jalur";
    } else if (delta <= 15) {
      pacingStatus = "agak_boros";
    } else {
      pacingStatus = "overpace";
    }
  }

  // Previous cycle comparison up to day N
  let currentCutoffDate = bounds.end;
  if (selectedPeriod === currentPeriod) {
    if (today < bounds.start) {
      currentCutoffDate = bounds.start;
    } else if (today <= bounds.end) {
      currentCutoffDate = today;
    }
  }
  const dayN = Math.max(1, daysBetween(bounds.start, currentCutoffDate) + 1);

  const currentSpentToDay = periodRows
    .filter(
      (tx) =>
        tx.type === "expense" &&
        !tx.isConvertedToInstallment &&
        tx.transactionDate <= currentCutoffDate,
    )
    .reduce((sum, tx) => sum + tx.amount, 0);

  const prevPeriod = shiftMonth(selectedPeriod, -1);
  const prevBounds = periodBounds(
    prevPeriod,
    cycle,
    snap.settings.gajianStartDay,
    snap.settings.cardCutoffDay,
  );
  const prevCutoffRaw = addDaysToDate(prevBounds.start, dayN - 1);
  let prevCutoffDate = prevCutoffRaw;
  if (prevCutoffDate > prevBounds.end) {
    prevCutoffDate = prevBounds.end;
  }

  const prevExpensesRows = await db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        gte(transactions.transactionDate, prevBounds.start),
        lte(transactions.transactionDate, prevCutoffDate),
        eq(transactions.type, "expense"),
        eq(transactions.isConvertedToInstallment, false),
      ),
    );
  const prevSpentToDay = prevExpensesRows.reduce((sum, r) => sum + r.amount, 0);

  const salaryReceivedThisCycle = periodRows.some(
    (tx) =>
      tx.sourceRef === `salary-${selectedPeriod}` ||
      (tx.type === "income" && tx.category.toLowerCase() === "gaji"),
  );

  const handPaidUpcoming = snap.activeInstallments
    .filter((inst) => {
      const acc = activeAccountMap.get(inst.accountId);
      return (
        acc &&
        !acc.closed &&
        acc.kind !== "payroll" &&
        acc.direction !== "receivable" &&
        inst.status === "upcoming"
      );
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
  const nextDueRaw =
    handPaidUpcoming.find((i) => i.dueDate >= today) ?? handPaidUpcoming[0] ?? null;
  const nextDueInstallment = nextDueRaw
    ? {
        ...nextDueRaw,
        accountName: activeAccountMap.get(nextDueRaw.accountId)?.name ?? "Utang",
        lender: activeAccountMap.get(nextDueRaw.accountId)?.lender ?? "",
        color: activeAccountMap.get(nextDueRaw.accountId)?.color ?? "#00797a",
      }
    : null;

  const gajianPeriod =
    cycle === "gajian"
      ? selectedPeriod
      : periodForDate(
          bounds.end,
          "gajian",
          snap.settings.gajianStartDay,
          snap.settings.cardCutoffDay,
        );
  const spentByCategory = new Map<string, number>();
  for (const [cat, v] of categoryMap.entries()) {
    spentByCategory.set(cat, v.total);
  }
  const budgetList = resolveBudgetsForPeriod(
    snap.budgets,
    gajianPeriod,
    spentByCategory,
    bounds.end,
    today,
  );

  const serializedTransactions = periodRows.map((tx) => {
    const srcWallet = walletById.get(tx.walletId);
    const dstWallet = tx.toWalletId ? walletById.get(tx.toWalletId) : null;
    const cardUnbilledStartKey = unbilledStartByCcWalletId.get(tx.walletId);
    const isUnbilledCc = Boolean(
      cardUnbilledStartKey &&
        ccWalletIds.has(tx.walletId) &&
        tx.type === "expense" &&
        !tx.isConvertedToInstallment &&
        tx.transactionDate >= cardUnbilledStartKey &&
        tx.transactionDate <= bounds.end,
    );
    const linkedFeeTransaction =
      tx.transferGroupId && tx.type === "transfer"
        ? (feeByGroupId.get(tx.transferGroupId) ?? null)
        : null;
    return {
      ...tx,
      walletName: srcWallet?.name ?? "Dompet",
      walletType: srcWallet?.type ?? "bank",
      toWalletName: dstWallet?.name ?? null,
      isUnbilledCc,
      splits: splitsByTxId.get(tx.id) ?? undefined,
      linkedFeeTransaction,
      createdAt: tx.createdAt.toISOString(),
      updatedAt: tx.updatedAt.toISOString(),
    };
  });

  const totalCcLimit = snap.ccWallets.reduce(
    (sum, w) => sum + (w.creditLimit ?? snap.settings.cardLimit),
    0,
  );
  const totalCcLimitUsed = snap.ccWallets.reduce((sum, w) => sum + w.limitUsed, 0);
  const totalCcLimitAvailable = Math.max(0, totalCcLimit - totalCcLimitUsed);

  const cycleTimeline = generateCycleTimeline(snap, bounds, today, salaryReceivedThisCycle);
  for (const bill of recurringBills) {
    if (bill.dueDateThisCycle >= bounds.start && bill.dueDateThisCycle <= bounds.end) {
      let status: "done" | "due_today" | "upcoming" | "overdue" = "upcoming";
      if (bill.isPaidThisCycle) {
        status = "done";
      } else if (bill.dueDateThisCycle < today) {
        status = "overdue";
      } else if (bill.dueDateThisCycle === today) {
        status = "due_today";
      }
      cycleTimeline.push({
        id: `recurring-${bill.id}-${bill.dueDateThisCycle}`,
        date: bill.dueDateThisCycle,
        title: `Tagihan: ${bill.merchant}`,
        category: "debt_due",
        amount: bill.isPaidThisCycle ? 0 : bill.amount,
        status,
        walletId: bill.walletId,
        badge: `Tgl ${bill.dueDay}`,
      });
    }
  }
  cycleTimeline.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const categoryBucketMap = new Map<string, "needs" | "wants" | "savings">();
  for (const cat of snap.categories) {
    categoryBucketMap.set(
      cat.name.toLowerCase(),
      (cat.bucket as "needs" | "wants" | "savings") ?? "needs",
    );
  }

  let spentNeeds = 0;
  let spentWants = 0;
  let spentSavings = 0;

  for (const tx of periodRows) {
    if (tx.type === "expense") {
      const bucket = categoryBucketMap.get(tx.category.toLowerCase()) ?? "needs";
      if (bucket === "needs") spentNeeds += tx.amount;
      else if (bucket === "wants") spentWants += tx.amount;
      else spentSavings += tx.amount;
    }
  }

  const incomeBaseline = totalIncome > 0 ? totalIncome : snap.settings.netSalary;

  const defNeeds = snap.budgets.find(
    (b) =>
      b.category.toLowerCase() === "bucket:needs" &&
      (b.period === "default" || b.period === selectedPeriod),
  );
  const defWants = snap.budgets.find(
    (b) =>
      b.category.toLowerCase() === "bucket:wants" &&
      (b.period === "default" || b.period === selectedPeriod),
  );
  const defSavings = snap.budgets.find(
    (b) =>
      b.category.toLowerCase() === "bucket:savings" &&
      (b.period === "default" || b.period === selectedPeriod),
  );

  const isConfiguredNeeds = !!(defNeeds && defNeeds.limitAmount > 0);
  const limitNeeds = isConfiguredNeeds ? defNeeds.limitAmount : 0;

  const isConfiguredWants = !!(defWants && defWants.limitAmount > 0);
  const limitWants = isConfiguredWants ? defWants.limitAmount : 0;

  const isConfiguredSavings = !!(defSavings && defSavings.limitAmount > 0);
  const targetSavings = isConfiguredSavings ? defSavings.limitAmount : 0;

  const budget503020 = {
    needs: {
      spent: spentNeeds,
      limit: limitNeeds,
      isConfigured: isConfiguredNeeds,
      percent: limitNeeds > 0 ? Math.round((spentNeeds / limitNeeds) * 100) : 0,
      status: (!isConfiguredNeeds
        ? "unconfigured"
        : spentNeeds > limitNeeds
          ? "exceeded"
          : spentNeeds >= limitNeeds * 0.8
            ? "warning"
            : "safe") as "safe" | "warning" | "exceeded" | "unconfigured",
    },
    wants: {
      spent: spentWants,
      limit: limitWants,
      isConfigured: isConfiguredWants,
      percent: limitWants > 0 ? Math.round((spentWants / limitWants) * 100) : 0,
      status: (!isConfiguredWants
        ? "unconfigured"
        : spentWants > limitWants
          ? "exceeded"
          : spentWants >= limitWants * 0.8
            ? "warning"
            : "safe") as "safe" | "warning" | "exceeded" | "unconfigured",
    },
    savings: {
      spent: spentSavings,
      target: targetSavings,
      isConfigured: isConfiguredSavings,
      percent: targetSavings > 0 ? Math.round((spentSavings / targetSavings) * 100) : 0,
      status: (!isConfiguredSavings
        ? "unconfigured"
        : spentSavings >= targetSavings
          ? "on_track"
          : "behind") as "on_track" | "behind" | "unconfigured",
    },
  };

  const monthTxMap = new Map<string, { expense: number; income: number; count: number }>();
  for (const tx of monthRows) {
    const entry = monthTxMap.get(tx.transactionDate) ?? { expense: 0, income: 0, count: 0 };
    if (tx.type === "expense") entry.expense += tx.amount;
    else if (tx.type === "income") entry.income += tx.amount;
    entry.count += 1;
    monthTxMap.set(tx.transactionDate, entry);
  }

  const calendarHeatmap = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = d < 10 ? `0${d}` : `${d}`;
    const dateStr = `${currentMonthPrefix}-${dayStr}`;
    const stats = monthTxMap.get(dateStr);
    calendarHeatmap.push({
      date: dateStr,
      expense: stats?.expense ?? 0,
      income: stats?.income ?? 0,
      count: stats?.count ?? 0,
      isToday: dateStr === today,
    });
  }

  const hasAnyTransactions = distinctDateRows.length > 0;
  const hasConfiguredWallet = snap.wallets.some((w) =>
    w.type === "credit_card" ? w.limitUsed !== 0 : w.openingBalance !== 0 || w.balance !== 0,
  );
  const hasConfiguredSalary = snap.settings.netSalary > 0 || snap.settings.grossSalary > 0;
  const hasConfiguredDebtsOrBudgets =
    snap.accounts.length > 0 || budgetList.some((b) => b.limitAmount > 0);
  const needsOnboarding =
    snap.wallets.length === 0 ||
    (!hasAnyTransactions &&
      !hasConfiguredWallet &&
      !hasConfiguredSalary &&
      !hasConfiguredDebtsOrBudgets);

  return {
    cycle,
    selectedPeriod,
    isCurrentPeriod: selectedPeriod === currentPeriod,
    needsOnboarding,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    availablePeriods,
    settings: {
      grossSalary: snap.settings.grossSalary,
      netSalary: snap.settings.netSalary,
      payrollDeduction: snap.settings.payrollDeduction,
      defaultSalaryWalletId: snap.settings.defaultSalaryWalletId,
      gajianStartDay: snap.settings.gajianStartDay,
      cardCutoffDay: snap.settings.cardCutoffDay,
      statementDay: snap.settings.statementDay,
      cardPaymentDay: snap.settings.cardPaymentDay,
      cardLimit: snap.settings.cardLimit,
    },
    metrics: {
      totalLiquidCash: snap.totalLiquidCash,
      totalSpendableCash: snap.totalSpendableCash,
      totalSavingsCash: snap.totalSavingsCash,
      ccReservedCash,
      remainingObligations,
      unpaidInstallmentsSum,
      unpaidCcCyclesSum,
      upcomingCcCyclesSum,
      unpaidRecurringSum,
      safeToSpend,
      cycleRemaining,
      dailyAllowance,
      daysElapsed,
      daysTotal,
      daysRemaining,
      timeProgressPercent,
      pacingStatus,
      previousCycleComparison: {
        currentSpentToDay,
        prevSpentToDay,
        dayN,
      },
      salaryReceivedThisCycle,
      totalIncome,
      totalExpense,
      surplus: totalIncome - totalExpense,
      totalCashOut,
      totalCcExpense,
      totalSettlement,
      totalTransfer,
      ccBilled,
      ccUnbilled,
      ccUnbilledCount,
      ccUnbilledStart: primaryUnbilledStartKey,
      ccLimit: totalCcLimit,
      ccLimitUsed: totalCcLimitUsed,
      ccLimitAvailable: totalCcLimitAvailable,
    },
    wallets: snap.wallets,
    nextDueInstallment,
    unpaidCcCycles,
    upcomingCcCycles,
    cycleTimeline,
    budgets: budgetList,
    budgetAlerts: budgetList.filter((b) => b.percentUsed >= 80),
    categoryTotals: [...categoryMap.entries()]
      .map(([category, v]) => ({ category, total: v.total, count: v.count }))
      .sort((a, b) => b.total - a.total),
    incomeCategoryTotals: [...incomeCategoryMap.entries()]
      .map(([category, v]) => ({ category, total: v.total, count: v.count }))
      .sort((a, b) => b.total - a.total),
    dailyTotals: [...dailyMap.entries()]
      .map(([date, v]) => ({ date, income: v.income, expense: v.expense }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    transactions: serializedTransactions,
    categories: snap.categories,
    recurringBills,
    budget503020,
    calendarHeatmap,
  };
}

export async function buildDebtsData(db: AppDb, today = jakartaToday()): Promise<DebtsDto> {
  const snap = await computeLedgerSnapshot(db, today);
  const accountById = new Map(snap.accounts.map((a) => [a.id, a]));

  const payableAccounts = snap.accounts.filter((a) => a.direction !== "receivable");
  const receivableAccounts = snap.accounts.filter((a) => a.direction === "receivable");

  const initialDebt = payableAccounts.reduce((sum, a) => sum + a.initialBalance, 0);
  const paidDebt = payableAccounts.reduce((sum, a) => sum + a.paidAmount, 0);
  const remainingDebt = Math.max(0, initialDebt - paidDebt);

  const initialReceivable = receivableAccounts.reduce((sum, a) => sum + a.initialBalance, 0);
  const paidReceivable = receivableAccounts.reduce((sum, a) => sum + a.paidAmount, 0);
  const remainingReceivable = Math.max(0, initialReceivable - paidReceivable);
  const netDebtPosition = remainingReceivable - remainingDebt;

  const ccWalletIds = snap.ccWallets.map((w) => w.id);
  const ccRows =
    ccWalletIds.length > 0
      ? await db
          .select()
          .from(transactions)
          .where(and(inArray(transactions.walletId, ccWalletIds), eq(transactions.type, "expense")))
          .orderBy(desc(transactions.transactionDate), desc(transactions.id))
      : [];

  const ccWalletMap = new Map(snap.ccWallets.map((w) => [w.id, w]));

  const ccTransactions = ccRows.map((tx) => ({
    ...tx,
    walletName: ccWalletMap.get(tx.walletId)?.name ?? "Kartu Kredit",
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  }));

  // Build per-card summaries
  const cards = snap.ccWallets.map((card) => {
    const cardTxs = ccTransactions.filter((t) => t.walletId === card.id);
    const cardCycles = new Set<string>([
      snap.currentCcCycle,
      shiftMonth(snap.currentCcCycle, -1),
      ...cardTxs.map((t) => t.ccCycleKey).filter((k): k is string => Boolean(k)),
    ]);

    const cardCycleSummaries = [...cardCycles]
      .sort()
      .reverse()
      .map((cycleKey) => {
        const cycleTxs = cardTxs.filter((t) => t.ccCycleKey === cycleKey);
        const dailyTotal = cycleTxs
          .filter((t) => !t.isConvertedToInstallment)
          .reduce((sum, t) => sum + t.amount, 0);
        const installmentItems = snap.activeInstallments.filter((inst) => {
          const acc = accountById.get(inst.accountId);
          return (
            acc &&
            !acc.closed &&
            acc.kind === "card_installment" &&
            (acc.walletId === card.id || (!acc.walletId && snap.ccWallets.length === 1)) &&
            inst.period === cycleKey
          );
        });
        const installmentTotal = installmentItems.reduce((sum, i) => sum + i.plannedAmount, 0);
        const unpaidInstallmentIds = installmentItems
          .filter((i) => i.status === "upcoming")
          .map((i) => i.id);
        const dailySettled = snap.isCycleSettledForWallet(card.id, cycleKey);
        return {
          cycleKey,
          dailyTotal,
          installmentTotal,
          totalBill: dailyTotal + installmentTotal,
          settled: dailySettled && unpaidInstallmentIds.length === 0,
          dailySettled,
          unpaidInstallmentIds,
          transactionCount: cycleTxs.length,
        };
      });

    const cutoffDay = card.cutoffDay ?? snap.settings.cardCutoffDay;
    const statementDay = card.statementDay ?? snap.settings.statementDay;
    const paymentDay = card.paymentDay ?? snap.settings.cardPaymentDay;

    return {
      walletId: card.id,
      walletName: card.name,
      color: card.color,
      creditLimit: card.creditLimit ?? snap.settings.cardLimit,
      limitUsed: card.limitUsed,
      balance: card.balance,
      currentCycleSpend: card.currentCycleSpend,
      cutoffDay,
      statementDay,
      paymentDay,
      cycleSummaries: cardCycleSummaries,
    };
  });

  const totalCcLimit = snap.ccWallets.reduce(
    (sum, w) => sum + (w.creditLimit ?? snap.settings.cardLimit),
    0,
  );
  const totalCcLimitUsed = snap.ccWallets.reduce((sum, w) => sum + w.limitUsed, 0);
  const totalCcLimitAvailable = Math.max(0, totalCcLimit - totalCcLimitUsed);

  // Aggregate cycle summaries for backward compatibility
  const primaryCard = cards[0];
  const cycleSummaries = primaryCard?.cycleSummaries ?? [];

  // Generate cycle timeline for the active period
  const gajianBounds = periodBounds(
    snap.currentCcCycle,
    "gajian",
    snap.settings.gajianStartDay,
    snap.settings.cardCutoffDay,
  );
  const cycleTimeline = generateCycleTimeline(snap, gajianBounds, today);

  return {
    currentCcCycle: snap.currentCcCycle,
    totals: {
      initialDebt,
      paidDebt,
      remainingDebt,
      initialReceivable,
      paidReceivable,
      remainingReceivable,
      netDebtPosition,
      ccLimit: totalCcLimit,
      ccLimitUsed: totalCcLimitUsed,
      ccLimitAvailable: totalCcLimitAvailable,
      currentCycleSpend: snap.ccSpendByCycle.get(snap.currentCcCycle) ?? 0,
    },
    accounts: snap.accounts.map((a) => ({
      ...a,
      direction: a.direction ?? "payable",
      disburseWalletId: a.disburseWalletId ?? null,
      disbursedAt: a.disbursedAt?.toISOString() ?? null,
      interestRateBps: a.interestRateBps ?? null,
      closedAt: a.closedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    })),
    installments: snap.activeInstallments.map((inst) => {
      const acc = accountById.get(inst.accountId);
      return {
        ...inst,
        accountName: acc?.name ?? "Utang",
        lender: acc?.lender ?? "",
        accountKind: acc?.kind ?? "loan",
        direction: acc?.direction ?? "payable",
        accountClosed: acc?.closed ?? false,
        principalAmount: inst.principalAmount ?? inst.plannedAmount,
        interestAmount: inst.interestAmount ?? 0,
        color: acc?.color ?? "#00797a",
        paidAt: inst.paidAt?.toISOString() ?? null,
      };
    }),
    cards,
    cycleTimeline,
    ccTransactions,
    cycleSummaries,
    wallets: snap.wallets,
  };
}
