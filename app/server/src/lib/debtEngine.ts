import { and, eq, inArray, sql } from "drizzle-orm";
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
import { addMonthsToDate, jakartaToday } from "./dates";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

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
  return due.length;
}

export function filterActiveInstallmentIds(
  accounts: Array<typeof debtAccounts.$inferSelect>,
  allInstallments: Array<typeof installments.$inferSelect>,
): Set<number> {
  // Drop stale future plan rows once paid installments cover the account's initial balance.
  const activeIds = new Set<number>();
  for (const account of accounts) {
    const rows = allInstallments
      .filter((item) => item.accountId === account.id)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
    let runningPaid = 0;
    for (const row of rows) {
      if (runningPaid >= account.initialBalance) break;
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

    // Check if installments are receivables or payables
    const accountIds = [...new Set(upcomingInstallments.map((i) => i.accountId))];
    const relatedAccounts =
      accountIds.length > 0
        ? await tx.select().from(debtAccounts).where(inArray(debtAccounts.id, accountIds))
        : [];
    const isReceivableCollection =
      relatedAccounts.length > 0 && relatedAccounts.every((a) => a.direction === "receivable");

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
              eq(settlementAllocations.ccWalletId, ccWallet.id),
              eq(settlementAllocations.ccCycleKey, input.ccCycleKey),
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
    let settledInstTotal = 0;
    for (const row of upcomingInstallments) {
      const actual =
        upcomingInstallments.length === 1 && !input.ccCycleKey && input.customAmount
          ? input.customAmount
          : row.plannedAmount;
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

    return {
      settledCount: upcomingInstallments.length,
      totalAmount,
      settlementTransactionId,
    };
  });
}

export async function unsettleInstallment(
  db: AppDb,
  input: { installmentId: number; removeSettlementTx?: boolean },
) {
  return await db.transaction(async (tx) => {
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

      if (settlementTx) {
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

    const [account] = await tx
      .insert(debtAccounts)
      .values({
        key,
        name: input.name,
        lender: input.lender,
        kind: input.kind,
        direction,
        walletId: input.walletId ?? null,
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
    if (input.recordDisbursement && disburseWalletId) {
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, disburseWalletId))
        .limit(1);
      if (!wallet) throw new ValidationError("Dompet pencairan tidak ditemukan.");

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
            walletId: disburseWalletId,
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
            walletId: disburseWalletId,
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
            period: item.period,
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
              period,
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
          allCats.find((c) => c.name.toLowerCase() === "hutang") ??
          allCats.find((c) => c.name.toLowerCase() === "pinjaman");
        const [createdTx] = await tx
          .insert(transactions)
          .values({
            type: "settlement",
            merchant: input.note?.trim() || `Pelunasan Dipercepat: ${account.name}`,
            amount: payoffAmount,
            transactionDate: input.paymentDate,
            category: debtCat?.name ?? "Hutang",
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

    for (const inst of upcoming) {
      await tx
        .update(installments)
        .set({
          status: "paid",
          actualAmount: inst.plannedAmount,
          paidAt,
          settlementTransactionId,
        })
        .where(eq(installments.id, inst.id));

      if (settlementTransactionId && inst.plannedAmount > 0) {
        await tx
          .insert(settlementAllocations)
          .values({
            settlementTransactionId,
            targetType: "installment",
            installmentId: inst.id,
            allocatedAmount: inst.plannedAmount,
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
    const paymentDay =
      input.paymentDay ?? wallet.paymentDay ?? settingsRows[0]?.cardPaymentDay ?? 25;
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

    const initialBalance = input.installmentCount * input.installmentAmount;
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

    const firstDueDate = `${input.firstPeriod}-${String(paymentDay).padStart(2, "0")}`;
    const scheduleRows = Array.from({ length: input.installmentCount }, (_, index) => {
      const { period, dueDate } = addMonthsToDate(firstDueDate, index);
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
