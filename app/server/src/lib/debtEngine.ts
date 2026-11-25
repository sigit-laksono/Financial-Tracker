import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AppDb } from "../db";
import {
  appSettings,
  categories,
  debtAccounts,
  installments,
  settlementAllocations,
  transactions,
  wallets,
} from "../db/schema";
import { recordAuditLog } from "./auditService";
import { computeWalletBalance } from "./cashLedger";
import { getCreditCardLimitStatus } from "./ccLimit";
import { addMonthsToDate, ccCycleForDate, ccDueDateForCycle, jakartaToday, shiftMonth } from "./dates";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { lockLedger } from "./ledgerLock";

const ACCOUNT_COLORS = [
  "#00797a",
  "#e16c10",
  "#2d54bc",
  "#a79300",
  "#c63895",
  "#a42423",
  "#059488",
];

function slugifyKey(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "utang"
  );
}

type DebtEngineDb = Pick<AppDb, "select" | "update" | "insert">;

function monthDiff(fromIsoDate: string, toIsoDate: string): number {
  const [fy = 0, fm = 0] = fromIsoDate.split("-").map(Number);
  const [ty = 0, tm = 0] = toIsoDate.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function allocateAmountProportionally(plannedAmounts: number[], targetTotal: number): number[] {
  if (plannedAmounts.length === 0) return [];
  const sumPlanned = plannedAmounts.reduce((sum, amt) => sum + amt, 0);
  if (targetTotal === sumPlanned) return [...plannedAmounts];
  if (sumPlanned <= 0) {
    const base = Math.floor(targetTotal / plannedAmounts.length);
    let rem = targetTotal - base * plannedAmounts.length;
    return plannedAmounts.map(() => {
      const extra = rem > 0 ? 1 : 0;
      if (rem > 0) rem -= 1;
      return base + extra;
    });
  }

  const parts = plannedAmounts.map((amt, index) => {
    const exact = (amt * targetTotal) / sumPlanned;
    const floored = Math.floor(exact);
    return { index, floored, frac: exact - floored };
  });
  let remainder = targetTotal - parts.reduce((sum, p) => sum + p.floored, 0);
  const byFrac = [...parts].sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let i = 0; i < byFrac.length && remainder > 0; i++) {
    byFrac[i]!.floored += 1;
    remainder -= 1;
  }
  const result = new Array<number>(plannedAmounts.length);
  for (const p of parts) {
    result[p.index] = p.floored;
  }
  return result;
}

export async function closeAccountsIfFullyPaid(
  db: DebtEngineDb,
  accountIds: number[],
  options: {
    action: "auto_close_settled" | "auto_close_payroll";
    resolveClosedAt: (paidRows: Array<typeof installments.$inferSelect>) => Date;
  },
): Promise<number[]> {
  if (accountIds.length === 0) return [];
  const accounts = await db
    .select()
    .from(debtAccounts)
    .where(inArray(debtAccounts.id, accountIds));
  const openAccounts = accounts.filter((a) => !a.closedAt);
  if (openAccounts.length === 0) return [];

  const allInsts = await db
    .select()
    .from(installments)
    .where(inArray(installments.accountId, openAccounts.map((a) => a.id)));

  const closedAccountIds: number[] = [];
  for (const account of openAccounts) {
    const accountRows = allInsts.filter((item) => item.accountId === account.id);
    const paidRows = accountRows.filter((item) => item.status === "paid");
    const paidAmount = paidRows.reduce(
      (sum, item) => sum + (item.actualAmount ?? item.plannedAmount),
      0,
    );
    const totalPlanned = accountRows.reduce((sum, item) => sum + item.plannedAmount, 0);
    const targetObligation = Math.max(account.initialBalance, totalPlanned);
    if (paidAmount >= targetObligation) {
      const closedAt = options.resolveClosedAt(paidRows);
      await db
        .update(debtAccounts)
        .set({ closedAt })
        .where(eq(debtAccounts.id, account.id));
      await recordAuditLog(db, {
        entityType: "debt_account",
        entityId: account.id,
        action: options.action,
        before: { closedAt: null },
        after: {
          closedAt: closedAt.toISOString(),
          paidAmount,
          initialBalance: account.initialBalance,
        },
      });
      closedAccountIds.push(account.id);
    }
  }
  return closedAccountIds;
}

export async function reopenDebtAccountsIfNeeded(
  db: Pick<AppDb, "select" | "update">,
  accountIds: number[],
): Promise<void> {
  if (accountIds.length === 0) return;
  const accounts = await db
    .select()
    .from(debtAccounts)
    .where(inArray(debtAccounts.id, accountIds));
  const closedAccounts = accounts.filter((a) => a.closedAt != null);
  if (closedAccounts.length === 0) return;

  const allInsts = await db
    .select()
    .from(installments)
    .where(inArray(installments.accountId, closedAccounts.map((a) => a.id)));

  for (const account of closedAccounts) {
    const accountRows = allInsts.filter((item) => item.accountId === account.id);
    const paidAmount = accountRows
      .filter((item) => item.status === "paid")
      .reduce((sum, item) => sum + (item.actualAmount ?? item.plannedAmount), 0);
    const totalPlanned = accountRows.reduce((sum, item) => sum + item.plannedAmount, 0);
    const targetObligation = Math.max(account.initialBalance, totalPlanned);
    if (targetObligation - paidAmount > 0) {
      await db
        .update(debtAccounts)
        .set({ closedAt: null })
        .where(eq(debtAccounts.id, account.id));
    }
  }
}

export async function ensurePayrollAutoPaid(db: AppDb, today = jakartaToday()): Promise<number> {
  const payrollAccounts = await db
    .select({ id: debtAccounts.id })
    .from(debtAccounts)
    .where(eq(debtAccounts.kind, "payroll"));
  if (payrollAccounts.length === 0) return 0;

  const payrollIds = payrollAccounts.map((a) => a.id);
  const rows = await db
    .select()
    .from(installments)
    .where(inArray(installments.accountId, payrollIds));
  const due = rows.filter((row) => row.status === "upcoming" && row.dueDate <= today);
  for (const row of due) {
    await db
      .update(installments)
      .set({
        status: "paid",
        actualAmount: row.plannedAmount,
        paidAt: new Date(`${row.dueDate}T00:00:00.000Z`),
      })
      .where(eq(installments.id, row.id));
  }

  const affectedIds = [...new Set(due.map((row) => row.accountId))];
  await closeAccountsIfFullyPaid(db, affectedIds, {
    action: "auto_close_payroll",
    resolveClosedAt: (paidRows) => {
      let latestPaidAt: Date | null = null;
      for (const row of paidRows) {
        if (row.paidAt && (!latestPaidAt || row.paidAt > latestPaidAt)) {
          latestPaidAt = row.paidAt;
        }
      }
      return latestPaidAt ?? new Date(`${today}T00:00:00.000Z`);
    },
  });

  return due.length;
}

export function filterActiveInstallmentIds(
  accounts: Array<typeof debtAccounts.$inferSelect>,
  allInstallments: Array<typeof installments.$inferSelect>,
): Set<number> {
  // Drop stale future plan rows only after paid installments cover both initialBalance and total planned schedule.
  const activeIds = new Set<number>();
  for (const account of accounts) {
    const rows = allInstallments
      .filter((item) => item.accountId === account.id)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
    const totalPlanned = rows.reduce((sum, item) => sum + item.plannedAmount, 0);
    const targetObligation = Math.max(account.initialBalance, totalPlanned);
    let runningPaid = 0;
    for (const row of rows) {
      if (runningPaid >= targetObligation) break;
      activeIds.add(row.id);
      if (row.status === "paid") {
        runningPaid += row.actualAmount ?? row.plannedAmount;
      }
    }
  }
  return activeIds;
}

export async function settleObligations(
  db: AppDb,
  input: {
    installmentIds?: number[];
    ccWalletId?: number;
    ccCycleKey?: string;
    fromWalletId: number;
    paymentDate: string;
    customAmount?: number;
    recordSettlementTx?: boolean;
    note?: string;
    preventOverdraft?: boolean;
  },
) {
  const recordTx = input.recordSettlementTx ?? true;
  const ids = input.installmentIds ?? [];
  if (ids.length === 0 && !input.ccCycleKey) {
    throw new ValidationError("Pilih minimal satu cicilan atau siklus tagihan CC.");
  }

  return await db.transaction(async (tx) => {
    await lockLedger(tx);

    const [payWallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.fromWalletId))
      .limit(1);
    if (!payWallet || payWallet.type === "credit_card") {
      throw new ValidationError(
        "Pilih dompet bank, e-wallet, atau tunai sebagai sumber pembayaran.",
      );
    }

    const ccWallets = await tx.select().from(wallets).where(eq(wallets.type, "credit_card"));
    const ccWallet = input.ccWalletId
      ? (ccWallets.find((w) => w.id === input.ccWalletId) ?? null)
      : (ccWallets[0] ?? null);

    const [settingsRow] = await tx.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    const legacyCutoff = settingsRow?.legacySettledBeforeCycle ?? null;

    const targetInstallments =
      ids.length > 0
        ? await tx.select().from(installments).where(inArray(installments.id, ids))
        : [];
    const upcomingInstallments = targetInstallments.filter((r) => r.status === "upcoming");
    if (ids.length > 0 && upcomingInstallments.length === 0 && !input.ccCycleKey) {
      throw new ConflictError("Cicilan yang dipilih sudah lunas.");
    }

    // Check if installments are receivables or payables
    const accountIds = [...new Set(upcomingInstallments.map((i) => i.accountId))];
    const relatedAccounts =
      accountIds.length > 0
        ? await tx.select().from(debtAccounts).where(inArray(debtAccounts.id, accountIds))
        : [];
    const hasReceivable = relatedAccounts.some((a) => a.direction === "receivable");
    const hasPayable = relatedAccounts.some((a) => a.direction !== "receivable");
    if (hasReceivable && hasPayable) {
      throw new ValidationError(
        "Tidak dapat menggabungkan pelunasan utang dan penagihan piutang dalam satu transaksi.",
      );
    }
    if (hasReceivable && input.ccCycleKey) {
      throw new ValidationError(
        "Penagihan piutang tidak dapat digabungkan dengan pembayaran tagihan kartu kredit.",
      );
    }
    const isReceivableCollection = relatedAccounts.length > 0 && hasReceivable;

    const isSingleCc = ccWallets.length <= 1;
    let remainingCcDaily = 0;
    if (input.ccCycleKey) {
      if (!ccWallet) {
        throw new ValidationError("Dompet kartu kredit tidak ditemukan.");
      }
      const isLegacySettled = Boolean(legacyCutoff && input.ccCycleKey <= legacyCutoff);
      if (!isLegacySettled) {
        const [ccGrossRow] = await tx
          .select({ total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)` })
          .from(transactions)
          .where(
            and(
              eq(transactions.walletId, ccWallet.id),
              eq(transactions.type, "expense"),
              eq(transactions.ccCycleKey, input.ccCycleKey),
              eq(transactions.isConvertedToInstallment, false),
            ),
          );
        const ccDailyGross = Number(ccGrossRow?.total ?? 0);

        const [allocRow] = await tx
          .select({
            total: sql<number>`COALESCE(SUM(${settlementAllocations.allocatedAmount}), 0)`,
          })
          .from(settlementAllocations)
          .where(
            and(
              eq(settlementAllocations.targetType, "cc_cycle"),
              eq(settlementAllocations.ccCycleKey, input.ccCycleKey),
              isSingleCc
                ? or(
                    eq(settlementAllocations.ccWalletId, ccWallet.id),
                    isNull(settlementAllocations.ccWalletId),
                  )
                : eq(settlementAllocations.ccWalletId, ccWallet.id),
            ),
          );
        const priorSettledDaily = Number(allocRow?.total ?? 0);

        remainingCcDaily = Math.max(0, ccDailyGross - priorSettledDaily);
      }

      if (upcomingInstallments.length === 0 && remainingCcDaily === 0) {
        throw new ConflictError(`Tagihan CC siklus ${input.ccCycleKey} sudah lunas.`);
      }
    }

    const installmentsSum = upcomingInstallments.reduce((sum, r) => sum + r.plannedAmount, 0);
    const totalAmount =
      input.customAmount && input.customAmount > 0
        ? input.customAmount
        : installmentsSum + remainingCcDaily;

    if (upcomingInstallments.length === 0 && totalAmount <= 0) {
      throw new ValidationError("Tidak ada tagihan atau cicilan yang perlu dilunasi.");
    }

    if (input.preventOverdraft && !isReceivableCollection && totalAmount > 0) {
      const currentPayBalance = await computeWalletBalance(tx, payWallet.id, payWallet.openingBalance);
      if (currentPayBalance < totalAmount) {
        throw new ValidationError(
          `Saldo dompet ${payWallet.name} tidak mencukupi untuk pembayaran tagihan (Saldo: Rp${currentPayBalance.toLocaleString("id-ID")}, Tagihan: Rp${totalAmount.toLocaleString("id-ID")}).`,
        );
      }
    }

    const allCategories = await tx.select().from(categories);
    const debtCat =
      allCategories.find((c) => {
        const n = c.name.trim().toLowerCase();
        return n === "cicilan & hutang" || n === "hutang";
      }) ?? allCategories.find((c) => c.name.toLowerCase().includes("hutang"));
    const piutangCat =
      allCategories.find((c) => {
        const n = c.name.trim().toLowerCase();
        return n === "piutang" || n === "pinjaman";
      }) ?? allCategories.find((c) => c.name.toLowerCase().includes("piutang"));

    let settlementTransactionId: number | null = null;
    if (recordTx && totalAmount > 0) {
      const ccLabel = ccWallet?.name ?? "Kartu Kredit";
      let label: string;
      let txType: "settlement" | "debt_collection" = "settlement";
      let chosenCat = debtCat;

      if (isReceivableCollection) {
        txType = "debt_collection";
        chosenCat = piutangCat ?? debtCat;
        label =
          input.note?.trim() ||
          (upcomingInstallments.length === 1
            ? `Terima Piutang (${upcomingInstallments[0]!.period})`
            : `Terima ${upcomingInstallments.length} Cicilan Piutang`);
      } else {
        txType = "settlement";
        label = input.ccCycleKey
          ? `Bayar Tagihan ${ccLabel} ${input.ccCycleKey}`
          : upcomingInstallments.length === 1
            ? `Bayar Cicilan (${upcomingInstallments[0]!.period})`
            : `Bayar ${upcomingInstallments.length} Cicilan`;
      }

      const [createdTx] = await tx
        .insert(transactions)
        .values({
          type: txType,
          merchant: label,
          amount: totalAmount,
          transactionDate: input.paymentDate,
          category: chosenCat?.name ?? (isReceivableCollection ? "Piutang" : "Hutang"),
          categoryId: chosenCat?.id ?? null,
          walletId: payWallet.id,
          toWalletId: input.ccCycleKey && ccWallet ? ccWallet.id : null,
          ccCycleKey: input.ccCycleKey ?? null,
          installmentId: upcomingInstallments.length === 1 ? upcomingInstallments[0]!.id : null,
          debtAccountId: relatedAccounts[0]?.id ?? null,
          note: input.note?.trim() || null,
          source: "manual",
        })
        .returning({ id: transactions.id });
      settlementTransactionId = createdTx?.id ?? null;
    }

    const paidAt = new Date(`${input.paymentDate}T00:00:00.000Z`);
    const allocationTargets = upcomingInstallments.map((r) => r.plannedAmount);
    if (input.ccCycleKey && remainingCcDaily > 0) {
      allocationTargets.push(remainingCcDaily);
    }
    const allocatedParts = allocateAmountProportionally(allocationTargets, totalAmount);

    let settledInstTotal = 0;
    for (let i = 0; i < upcomingInstallments.length; i++) {
      const row = upcomingInstallments[i]!;
      const actual = allocatedParts[i] ?? row.plannedAmount;
      settledInstTotal += actual;
      await tx
        .update(installments)
        .set({
          status: "paid",
          actualAmount: actual,
          paidAt,
          settlementTransactionId,
        })
        .where(eq(installments.id, row.id));

      if (settlementTransactionId && actual > 0) {
        await tx
          .insert(settlementAllocations)
          .values({
            settlementTransactionId,
            targetType: "installment",
            installmentId: row.id,
            allocatedAmount: actual,
          });
      }
    }

    if (settlementTransactionId && input.ccCycleKey && ccWallet) {
      const ccAllocated = Math.max(0, totalAmount - settledInstTotal);
      if (ccAllocated > 0) {
        await tx
          .insert(settlementAllocations)
          .values({
            settlementTransactionId,
            targetType: "cc_cycle",
            ccWalletId: ccWallet.id,
            ccCycleKey: input.ccCycleKey,
            allocatedAmount: ccAllocated,
          });
      }
    }

    const closedAccountIds = await closeAccountsIfFullyPaid(
      tx,
      relatedAccounts.map((a) => a.id),
      {
        action: "auto_close_settled",
        resolveClosedAt: () => paidAt,
      },
    );

    return {
      settledCount: upcomingInstallments.length,
      totalAmount,
      settlementTransactionId,
      closedAccountIds,
    };
  });
}

export async function unsettleInstallment(
  db: AppDb,
  input: { installmentId: number; removeSettlementTx?: boolean },
) {
  return await db.transaction(async (tx) => {
    await lockLedger(tx);
    const [row] = await tx
      .select()
      .from(installments)
      .where(eq(installments.id, input.installmentId))
      .limit(1);
    if (!row) throw new NotFoundError("Cicilan tidak ditemukan.");

    const settlementId = row.settlementTransactionId;
    const revertedAmount = row.actualAmount ?? row.plannedAmount;

    await tx
      .update(installments)
      .set({
        status: "upcoming",
        actualAmount: null,
        paidAt: null,
        settlementTransactionId: null,
      })
      .where(eq(installments.id, row.id));

    if (settlementId) {
      await tx
        .delete(settlementAllocations)
        .where(
          and(
            eq(settlementAllocations.settlementTransactionId, settlementId),
            eq(settlementAllocations.targetType, "installment"),
            eq(settlementAllocations.installmentId, row.id),
          ),
        );
    }

    if (input.removeSettlementTx && settlementId) {
      const [settlementTx] = await tx
        .select()
        .from(transactions)
        .where(eq(transactions.id, settlementId))
        .limit(1);

      // Payroll installments are linked to the salary income transaction. Its amount is
      // the net salary actually received, so it must never be rewritten or deleted here.
      const isPaymentTx =
        settlementTx?.type === "settlement" || settlementTx?.type === "debt_collection";

      if (settlementTx && isPaymentTx) {
        const remainingAllocs = await tx
          .select({
            targetType: settlementAllocations.targetType,
            installmentId: settlementAllocations.installmentId,
            allocatedAmount: settlementAllocations.allocatedAmount,
          })
          .from(settlementAllocations)
          .where(eq(settlementAllocations.settlementTransactionId, settlementId));

        const newAmount =
          remainingAllocs.length > 0
            ? remainingAllocs.reduce((sum, a) => sum + a.allocatedAmount, 0)
            : settlementTx.amount - revertedAmount;
        const remainingInstIds = remainingAllocs
          .filter((a) => a.targetType === "installment" && a.installmentId !== null)
          .map((a) => a.installmentId!);

        if (remainingAllocs.length === 0 && newAmount <= 0) {
          await tx.delete(transactions).where(eq(transactions.id, settlementId));
        } else {
          await tx
            .update(transactions)
            .set({
              amount: Math.max(0, newAmount),
              installmentId: remainingInstIds.length === 1 ? remainingInstIds[0]! : null,
              updatedAt: new Date(),
            })
            .where(eq(transactions.id, settlementId));
        }
      }
    }

    await reopenDebtAccountsIfNeeded(tx, [row.accountId]);

    await recordAuditLog(tx, {
      entityType: "installment",
      entityId: row.id,
      action: "unsettle",
      before: {
        status: row.status,
        actualAmount: row.actualAmount,
        settlementTransactionId: settlementId,
      },
      after: { status: "upcoming", removeSettlementTx: Boolean(input.removeSettlementTx) },
    });

    return { ok: true };
  });
}

async function resolveCreditCardWalletInfo(
  tx: Pick<AppDb, "select">,
  requestedWalletId: number | null | undefined,
): Promise<{ walletId: number; cutoffDay: number; ccCount: number }> {
  const ccWallets = await tx
    .select({ id: wallets.id, cutoffDay: wallets.cutoffDay })
    .from(wallets)
    .where(eq(wallets.type, "credit_card"));
  const [settingsRow] = await tx
    .select({ cardCutoffDay: appSettings.cardCutoffDay })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  const defaultCutoff = settingsRow?.cardCutoffDay ?? 20;

  if (requestedWalletId) {
    const matched = ccWallets.find((w) => w.id === requestedWalletId);
    if (!matched) {
      throw new ValidationError("Dompet kartu kredit yang dipilih tidak ditemukan.");
    }
    return {
      walletId: matched.id,
      cutoffDay: matched.cutoffDay ?? defaultCutoff,
      ccCount: ccWallets.length,
    };
  }
  if (ccWallets.length === 0) {
    throw new ValidationError(
      "Tambahkan dompet Kartu Kredit terlebih dahulu sebelum mencatat cicilan kartu kredit.",
    );
  }
  if (ccWallets.length > 1) {
    throw new ValidationError("Pilih kartu kredit yang menanggung cicilan ini.");
  }
  return {
    walletId: ccWallets[0]!.id,
    cutoffDay: ccWallets[0]!.cutoffDay ?? defaultCutoff,
    ccCount: ccWallets.length,
  };
}

export async function createDebtAccountWithSchedule(
  db: AppDb,
  input: {
    name: string;
    lender: string;
    kind: "loan" | "card_installment" | "payroll" | "receivable";
    direction?: "payable" | "receivable";
    initialBalance: number;
    installmentCount: number;
    installmentAmount: number;
    principalAmount?: number;
    interestAmount?: number;
    firstDueDate: string;
    paymentMethod: string;
    walletId?: number | null;
    color?: string;
    disburseWalletId?: number | null;
    recordDisbursement?: boolean;
    interestRateBps?: number;
    customSchedule?: Array<{
      monthIndex: number;
      period: string;
      dueDate: string;
      plannedAmount: number;
      principalAmount?: number;
      interestAmount?: number;
    }>;
  },
) {
  return await db.transaction(async (tx) => {
    await lockLedger(tx);
    const existing = await tx
      .select({ id: debtAccounts.id, key: debtAccounts.key })
      .from(debtAccounts);
    const baseKey = slugifyKey(input.name);
    let key = baseKey;
    let suffix = 2;
    const keySet = new Set(existing.map((e) => e.key));
    while (keySet.has(key)) {
      key = `${baseKey}-${suffix}`;
      suffix += 1;
    }

    const direction = input.direction ?? (input.kind === "receivable" ? "receivable" : "payable");
    const paymentDay = Number(input.firstDueDate.split("-")[2] ?? "1");
    const color =
      input.color ?? ACCOUNT_COLORS[existing.length % ACCOUNT_COLORS.length] ?? "#00797a";

    const disburseWalletId = input.disburseWalletId ?? null;
    let disbursedAt: Date | null = null;

    const effectiveInitialBalance =
      input.customSchedule && input.customSchedule.length > 0
        ? input.customSchedule.reduce((sum, item) => sum + item.plannedAmount, 0)
        : input.initialBalance;

    let resolvedWalletId = input.walletId ?? null;
    let resolvedCcCutoffDay: number | null = null;
    if (input.kind === "card_installment") {
      const resolved = await resolveCreditCardWalletInfo(tx, resolvedWalletId);
      resolvedWalletId = resolved.walletId;
      resolvedCcCutoffDay = resolved.cutoffDay;

      const limitStatus = await getCreditCardLimitStatus(tx, resolvedWalletId);
      if (effectiveInitialBalance > limitStatus.availableLimit) {
        throw new ValidationError(
          `Total cicilan melebihi sisa limit ${limitStatus.walletName} (Sisa limit: Rp${limitStatus.availableLimit.toLocaleString("id-ID")}, Total cicilan: Rp${effectiveInitialBalance.toLocaleString("id-ID")}).`,
        );
      }
    }

    const [account] = await tx
      .insert(debtAccounts)
      .values({
        key,
        name: input.name,
        lender: input.lender,
        kind: input.kind,
        direction,
        walletId: resolvedWalletId,
        initialBalance: effectiveInitialBalance,
        paymentDay,
        paymentMethod: input.paymentMethod,
        color,
        disburseWalletId,
        disbursedAt,
        interestRateBps: input.interestRateBps ?? null,
      })
      .returning({ id: debtAccounts.id });
    if (!account) throw new Error("Gagal menyimpan akun utang.");

    // Handle immediate wallet movement (disbursement)
    let disburseWallet: typeof wallets.$inferSelect | null = null;
    if (disburseWalletId) {
      const [foundWallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, disburseWalletId))
        .limit(1);
      if (!foundWallet) throw new ValidationError("Dompet pencairan tidak ditemukan.");
      if (foundWallet.type === "credit_card") {
        throw new ValidationError("Dompet kartu kredit tidak dapat digunakan sebagai dompet pencairan.");
      }
      disburseWallet = foundWallet;
    }

    if (input.recordDisbursement && disburseWallet) {
      const wallet = disburseWallet;

      const allCats = await tx.select().from(categories);
      const today = jakartaToday();
      disbursedAt = new Date(`${today}T00:00:00.000Z`);

      if (direction === "payable") {
        // Loan disbursed into user's wallet (e.g. Flexi Cash to Jenius)
        const loanCat =
          allCats.find((c) => {
            const n = c.name.toLowerCase();
            return n === "pinjaman" || n === "piutang" || n.includes("pinjam");
          }) ??
          allCats.find((c) => c.type === "income");
        await tx
          .insert(transactions)
          .values({
            type: "loan_disbursement",
            merchant: `Pencairan ${input.name}`,
            amount: input.initialBalance,
            transactionDate: today,
            category: loanCat?.name ?? "Pinjaman",
            categoryId: loanCat?.id ?? null,
            walletId: wallet.id,
            debtAccountId: account.id,
            source: "system",
            note: `Pencairan dana ${input.name} ke dompet ${wallet.name}`,
          });
      } else {
        // Receivable lent from user's wallet to someone (talangan keluar)
        const piutangCat =
          allCats.find((c) => c.name.toLowerCase() === "piutang") ??
          allCats.find((c) => c.name.toLowerCase() === "pinjaman") ??
          allCats.find((c) => c.type === "expense");
        await tx
          .insert(transactions)
          .values({
            type: "debt_disbursement",
            merchant: `Talangan/Pinjaman: ${input.name}`,
            amount: input.initialBalance,
            transactionDate: today,
            category: piutangCat?.name ?? "Piutang",
            categoryId: piutangCat?.id ?? null,
            walletId: wallet.id,
            debtAccountId: account.id,
            source: "system",
            note: `Pemberian pinjaman/talangan ${input.name} dari dompet ${wallet.name}`,
          });
      }

      await tx
        .update(debtAccounts)
        .set({ disburseWalletId, disbursedAt })
        .where(eq(debtAccounts.id, account.id));
    }

    const scheduleRows =
      input.customSchedule && input.customSchedule.length > 0
        ? input.customSchedule.map((item) => ({
            accountId: account.id,
            period:
              resolvedCcCutoffDay !== null
                ? ccCycleForDate(item.dueDate, resolvedCcCutoffDay)
                : item.period,
            dueDate: item.dueDate,
            plannedAmount: item.plannedAmount,
            principalAmount: item.principalAmount ?? item.plannedAmount,
            interestAmount: item.interestAmount ?? 0,
            status: "upcoming" as const,
          }))
        : Array.from({ length: input.installmentCount }, (_, index) => {
            const { period, dueDate } = addMonthsToDate(input.firstDueDate, index);
            const planned = input.installmentAmount;
            const principal = input.principalAmount ?? planned;
            const interest = input.interestAmount ?? 0;
            return {
              accountId: account.id,
              period:
                resolvedCcCutoffDay !== null
                  ? ccCycleForDate(dueDate, resolvedCcCutoffDay)
                  : period,
              dueDate,
              plannedAmount: planned,
              principalAmount: principal,
              interestAmount: interest,
              status: "upcoming" as const,
            };
          });
    await tx.insert(installments).values(scheduleRows);

    return { accountId: account.id, installmentCount: scheduleRows.length };
  });
}

export async function updateDebtAccountWithSchedule(
  db: AppDb,
  accountId: number,
  input: {
    name?: string;
    lender?: string;
    kind?: "loan" | "card_installment" | "payroll" | "receivable";
    paymentMethod?: string;
    walletId?: number | null;
    installments?: Array<{
      id: number;
      dueDate: string;
      plannedAmount: number;
    }>;
  },
) {
  return await db.transaction(async (tx) => {
    await lockLedger(tx);
    const [account] = await tx
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, accountId))
      .limit(1);
    if (!account) throw new NotFoundError("Akun utang/piutang tidak ditemukan.");

    const nextKind =
      account.direction === "receivable"
        ? "receivable"
        : input.kind && input.kind !== "receivable"
          ? input.kind
          : account.kind;

    if (account.sourceTransactionId && nextKind !== "card_installment") {
      throw new ValidationError("Cicilan hasil Split Pay kartu kredit tidak dapat diubah jenisnya.");
    }
    if (
      account.sourceTransactionId &&
      input.walletId !== undefined &&
      input.walletId !== account.walletId
    ) {
      throw new ValidationError("Kartu kredit sumber untuk cicilan Split Pay tidak dapat dipindahkan.");
    }

    const existingInsts = await tx
      .select()
      .from(installments)
      .where(eq(installments.accountId, accountId));
    const existingById = new Map(existingInsts.map((row) => [row.id, row]));

    const updatesByInstId = new Map<number, { dueDate: string; plannedAmount: number }>();
    if (input.installments) {
      for (const item of input.installments) {
        const row = existingById.get(item.id);
        if (!row) {
          throw new ValidationError("Jadwal cicilan tidak sesuai dengan akun ini.");
        }
        if (
          row.status === "paid" &&
          (row.dueDate !== item.dueDate || row.plannedAmount !== item.plannedAmount)
        ) {
          throw new ValidationError("Cicilan yang sudah lunas tidak dapat diubah tanggal atau nominalnya.");
        }
        if (row.status === "upcoming") {
          updatesByInstId.set(item.id, {
            dueDate: item.dueDate,
            plannedAmount: item.plannedAmount,
          });
        }
      }
    }

    let prevPaidAmount = 0;
    let nextInitialBalance = 0;
    let nextRemainingBalance = 0;
    const finalDueDates: string[] = [];

    for (const row of existingInsts) {
      const edited = updatesByInstId.get(row.id);
      const effectiveDueDate = edited?.dueDate ?? row.dueDate;
      const effectivePlanned = edited?.plannedAmount ?? row.plannedAmount;
      finalDueDates.push(effectiveDueDate);

      if (row.status === "paid") {
        const paidAmt = row.actualAmount ?? row.plannedAmount;
        prevPaidAmount += paidAmt;
        nextInitialBalance += paidAmt;
      } else {
        nextInitialBalance += effectivePlanned;
        nextRemainingBalance += effectivePlanned;
      }
    }

    if (existingInsts.length === 0) {
      nextInitialBalance = account.initialBalance;
      nextRemainingBalance = account.initialBalance;
    }

    const prevRemainingBalance = Math.max(0, account.initialBalance - prevPaidAmount);

    let nextWalletId: number | null = null;
    let nextCcCutoffDay: number | null = null;
    if (nextKind === "card_installment") {
      const requestedWalletId =
        input.walletId !== undefined ? input.walletId : account.walletId;
      const resolved = await resolveCreditCardWalletInfo(tx, requestedWalletId);
      nextWalletId = resolved.walletId;
      nextCcCutoffDay = resolved.cutoffDay;

      if (!account.closedAt) {
        const limitStatus = await getCreditCardLimitStatus(tx, nextWalletId);
        const alreadyCountedOnTargetCard =
          account.kind === "card_installment" &&
          (account.walletId === nextWalletId ||
            (resolved.ccCount <= 1 && account.walletId === null));
        const effectiveAvailable =
          limitStatus.availableLimit + (alreadyCountedOnTargetCard ? prevRemainingBalance : 0);

        if (nextRemainingBalance > effectiveAvailable) {
          throw new ValidationError(
            `Sisa cicilan melebihi sisa limit ${limitStatus.walletName} (Sisa limit tersedia: Rp${effectiveAvailable.toLocaleString("id-ID")}, Total sisa cicilan: Rp${nextRemainingBalance.toLocaleString("id-ID")}).`,
          );
        }
      }
    }

    for (const row of existingInsts) {
      if (row.status !== "upcoming") continue;
      const patch = updatesByInstId.get(row.id);
      const effectiveDueDate = patch?.dueDate ?? row.dueDate;
      const effectivePlanned = patch?.plannedAmount ?? row.plannedAmount;
      const effectivePeriod =
        nextKind === "card_installment" && nextCcCutoffDay !== null && !account.sourceTransactionId
          ? ccCycleForDate(effectiveDueDate, nextCcCutoffDay)
          : account.sourceTransactionId
            ? // Split Pay rows store their billing cycle in `period`, not the due month.
              // Keep it, shifting by the same number of months the due date moved.
              shiftMonth(row.period, monthDiff(row.dueDate, effectiveDueDate))
            : effectiveDueDate.slice(0, 7);

      if (
        patch ||
        effectivePeriod !== row.period
      ) {
        await tx
          .update(installments)
          .set({
            dueDate: effectiveDueDate,
            period: effectivePeriod,
            plannedAmount: effectivePlanned,
            principalAmount: effectivePlanned,
          })
          .where(eq(installments.id, row.id));
      }
    }

    finalDueDates.sort((a, b) => a.localeCompare(b));
    const nextPaymentDay = finalDueDates[0]
      ? Number(finalDueDates[0].split("-")[2] ?? account.paymentDay ?? 1)
      : account.paymentDay;

    const nextName = input.name?.trim() || account.name;
    const nextLender = input.lender?.trim() || account.lender;
    const nextPaymentMethod = input.paymentMethod?.trim() || account.paymentMethod;

    await tx
      .update(debtAccounts)
      .set({
        name: nextName,
        lender: nextLender,
        kind: nextKind,
        walletId: nextWalletId,
        paymentMethod: nextPaymentMethod,
        initialBalance: nextInitialBalance,
        paymentDay: nextPaymentDay,
      })
      .where(eq(debtAccounts.id, accountId));

    await recordAuditLog(tx, {
      entityType: "debt_account",
      entityId: accountId,
      action: "update_debt_account",
      before: {
        name: account.name,
        lender: account.lender,
        kind: account.kind,
        walletId: account.walletId,
        initialBalance: account.initialBalance,
        paymentMethod: account.paymentMethod,
      },
      after: {
        name: nextName,
        lender: nextLender,
        kind: nextKind,
        walletId: nextWalletId,
        initialBalance: nextInitialBalance,
        paymentMethod: nextPaymentMethod,
      },
    });

    return { ok: true, accountId, initialBalance: nextInitialBalance };
  });
}

export async function earlyPayoffDebtAccount(
  db: AppDb,
  accountId: number,
  input: {
    fromWalletId: number;
    paymentDate: string;
    customAmount?: number;
    note?: string;
    preventOverdraft?: boolean;
  },
) {
  return await db.transaction(async (tx) => {
    await lockLedger(tx);
    const [account] = await tx
      .select()
      .from(debtAccounts)
      .where(eq(debtAccounts.id, accountId))
      .limit(1);
    if (!account) throw new NotFoundError("Akun utang/piutang tidak ditemukan.");
    if (account.closedAt) {
      throw new ValidationError("Akun ini sudah lunas dan ditutup.");
    }

    const [payWallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.fromWalletId))
      .limit(1);
    if (!payWallet || payWallet.type === "credit_card") {
      throw new ValidationError("Pilih dompet bank, e-wallet, atau tunai.");
    }

    const upcoming = await tx
      .select()
      .from(installments)
      .where(and(eq(installments.accountId, account.id), eq(installments.status, "upcoming")));

    const remainingPlanned = upcoming.reduce((sum, r) => sum + r.plannedAmount, 0);
    const payoffAmount =
      input.customAmount && input.customAmount > 0 ? input.customAmount : remainingPlanned;

    if (input.preventOverdraft && account.direction !== "receivable" && payoffAmount > 0) {
      const currentPayBalance = await computeWalletBalance(tx, payWallet.id, payWallet.openingBalance);
      if (currentPayBalance < payoffAmount) {
        throw new ValidationError(
          `Saldo dompet ${payWallet.name} tidak mencukupi untuk pelunasan dipercepat (Saldo: Rp${currentPayBalance.toLocaleString("id-ID")}, Pelunasan: Rp${payoffAmount.toLocaleString("id-ID")}).`,
        );
      }
    }

    const paidAt = new Date(`${input.paymentDate}T00:00:00.000Z`);
    const allCats = await tx.select().from(categories);

    let settlementTransactionId: number | null = null;
    if (payoffAmount > 0) {
      if (account.direction === "receivable") {
        // Collecting remaining receivable in full
        const piutangCat =
          allCats.find((c) => {
            const n = c.name.toLowerCase();
            return n === "piutang" || n === "pinjaman" || n.includes("piutang");
          }) ??
          allCats.find((c) => c.name.toLowerCase() === "pinjaman");
        const [createdTx] = await tx
          .insert(transactions)
          .values({
            type: "debt_collection",
            merchant: input.note?.trim() || `Pelunasan Piutang: ${account.name}`,
            amount: payoffAmount,
            transactionDate: input.paymentDate,
            category: piutangCat?.name ?? "Piutang",
            categoryId: piutangCat?.id ?? null,
            walletId: payWallet.id,
            debtAccountId: account.id,
            source: "manual",
            note: input.note?.trim() || `Pelunasan dipercepat untuk piutang ${account.name}`,
          })
          .returning({ id: transactions.id });
        settlementTransactionId = createdTx?.id ?? null;
      } else {
        // Paying off remaining debt in full
        const debtCat =
          allCats.find((c) => c.name.trim().toLowerCase() === "cicilan & hutang") ??
          allCats.find((c) => c.name.trim().toLowerCase() === "hutang") ??
          allCats.find((c) => c.name.trim().toLowerCase() === "pinjaman") ??
          allCats.find((c) => c.name.toLowerCase().includes("hutang"));
        const [createdTx] = await tx
          .insert(transactions)
          .values({
            type: "settlement",
            merchant: input.note?.trim() || `Pelunasan Dipercepat: ${account.name}`,
            amount: payoffAmount,
            transactionDate: input.paymentDate,
            category: debtCat?.name ?? "Cicilan & Hutang",
            categoryId: debtCat?.id ?? null,
            walletId: payWallet.id,
            debtAccountId: account.id,
            source: "manual",
            note: input.note?.trim() || `Pelunasan dipercepat untuk akun ${account.name}`,
          })
          .returning({ id: transactions.id });
        settlementTransactionId = createdTx?.id ?? null;
      }
    }

    const allocatedInsts = allocateAmountProportionally(
      upcoming.map((inst) => inst.plannedAmount),
      payoffAmount,
    );
    for (let i = 0; i < upcoming.length; i++) {
      const inst = upcoming[i]!;
      const actual = allocatedInsts[i] ?? inst.plannedAmount;
      await tx
        .update(installments)
        .set({
          status: "paid",
          actualAmount: actual,
          paidAt,
          settlementTransactionId,
        })
        .where(eq(installments.id, inst.id));

      if (settlementTransactionId && actual > 0) {
        await tx
          .insert(settlementAllocations)
          .values({
            settlementTransactionId,
            targetType: "installment",
            installmentId: inst.id,
            allocatedAmount: actual,
          });
      }
    }

    // Atomically close the account
    await tx.update(debtAccounts).set({ closedAt: paidAt }).where(eq(debtAccounts.id, account.id));

    await recordAuditLog(tx, {
      entityType: "debt_account",
      entityId: account.id,
      action: "early_payoff",
      before: { closedAt: null },
      after: {
        closedAt: paidAt.toISOString(),
        payoffAmount,
        settledCount: upcoming.length,
        settlementTransactionId,
      },
    });

    return {
      ok: true,
      accountId: account.id,
      payoffAmount,
      settledCount: upcoming.length,
      settlementTransactionId,
    };
  });
}

export async function convertTransactionToInstallment(
  db: AppDb,
  input: {
    transactionId: number;
    name?: string;
    installmentCount: number;
    installmentAmount: number;
    firstPeriod: string;
    paymentDay?: number;
  },
) {
  return await db.transaction(async (tx) => {
    await lockLedger(tx);
    const [sourceTx] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, input.transactionId))
      .limit(1);
    if (!sourceTx) throw new NotFoundError("Transaksi tidak ditemukan.");
    if (sourceTx.type !== "expense") {
      throw new ValidationError(
        "Hanya transaksi pengeluaran kartu kredit yang bisa diubah ke cicilan.",
      );
    }
    if (sourceTx.isConvertedToInstallment) {
      throw new ConflictError("Transaksi ini sudah dikonversi menjadi cicilan.");
    }

    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, sourceTx.walletId))
      .limit(1);
    if (wallet?.type !== "credit_card") {
      throw new ValidationError("Konversi Split Pay hanya berlaku untuk transaksi kartu kredit.");
    }

    const settingsRows = await tx.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    const settings = settingsRows[0];
    const cutoffDay = wallet.cutoffDay ?? settings?.cardCutoffDay ?? 20;
    const paymentDay =
      input.paymentDay ?? wallet.paymentDay ?? settings?.cardPaymentDay ?? 25;
    const effectiveCycleKey =
      sourceTx.ccCycleKey ?? ccCycleForDate(sourceTx.transactionDate, cutoffDay);

    if (settings?.legacySettledBeforeCycle && effectiveCycleKey <= settings.legacySettledBeforeCycle) {
      throw new ValidationError(
        "Transaksi pada siklus kartu kredit yang sudah lunas tidak dapat diubah ke cicilan.",
      );
    }

    const limitStatus = await getCreditCardLimitStatus(tx, wallet.id);
    const unpaidCycleAmount = limitStatus.unpaidByCycle.get(effectiveCycleKey) ?? 0;
    if (unpaidCycleAmount <= 0) {
      throw new ValidationError(
        "Transaksi dari siklus kartu kredit yang sudah lunas tidak dapat diubah ke cicilan.",
      );
    }

    const initialBalance = input.installmentCount * input.installmentAmount;
    const creditBack = Math.min(sourceTx.amount, unpaidCycleAmount);
    const effectiveAvailable = limitStatus.availableLimit + creditBack;
    if (initialBalance > effectiveAvailable) {
      throw new ValidationError(
        `Total cicilan melebihi sisa limit ${limitStatus.walletName} (Sisa limit tersedia: Rp${effectiveAvailable.toLocaleString("id-ID")}, Total cicilan: Rp${initialBalance.toLocaleString("id-ID")}).`,
      );
    }

    const accountName = input.name?.trim() || `${sourceTx.merchant} (Split Pay)`;
    const existingKeys = new Set(
      (
        await tx
          .select({ key: debtAccounts.key })
          .from(debtAccounts)
      ).map((a) => a.key),
    );
    const baseKey = slugifyKey(`split-${sourceTx.id}-${sourceTx.merchant}`);
    let key = baseKey;
    let suffix = 2;
    while (existingKeys.has(key)) {
      key = `${baseKey}-${suffix}`;
      suffix += 1;
    }

    const [account] = await tx
      .insert(debtAccounts)
      .values({
        key,
        name: accountName,
        lender: wallet.name,
        kind: "card_installment",
        walletId: wallet.id,
        initialBalance,
        paymentDay,
        paymentMethod: "Tagihan kartu",
        color: "#e16c10",
        sourceTransactionId: sourceTx.id,
      })
      .returning({ id: debtAccounts.id });
    if (!account) throw new Error("Gagal membuat akun cicilan Split Pay.");

    const scheduleRows = Array.from({ length: input.installmentCount }, (_, index) => {
      const period = shiftMonth(input.firstPeriod, index);
      const dueDate = ccDueDateForCycle(period, cutoffDay, paymentDay);
      return {
        accountId: account.id,
        period,
        dueDate,
        plannedAmount: input.installmentAmount,
        status: "upcoming" as const,
      };
    });
    await tx.insert(installments).values(scheduleRows);

    await tx
      .update(transactions)
      .set({
        isConvertedToInstallment: true,
        convertedAccountId: account.id,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, sourceTx.id));

    return { accountId: account.id, initialBalance, installmentCount: scheduleRows.length };
  });
}
