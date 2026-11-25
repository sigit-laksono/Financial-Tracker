import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "../db";
import {
  categories,
  debtAccounts,
  installments,
  settlementAllocations,
  transactions,
  wallets,
} from "../db/schema";
import { recordAuditLog } from "./auditService";
import { gajianPeriodForDate, jakartaToday, periodBounds } from "./dates";
import { closeAccountsIfFullyPaid, filterActiveInstallmentIds } from "./debtEngine";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { lockLedger } from "./ledgerLock";
import { getSettings } from "./settingsService";

export async function getSalaryPreview(
  db: AppDb,
  options: {
    period?: string;
    grossSalary?: number;
    walletId?: number;
  } = {},
  today = jakartaToday(),
) {
  const settings = await getSettings(db);
  const targetPeriod = options.period ?? gajianPeriodForDate(today, settings.gajianStartDay);

  const sourceRef = `salary-${targetPeriod}`;
  const existing = await db
    .select({ id: transactions.id, amount: transactions.amount })
    .from(transactions)
    .where(eq(transactions.sourceRef, sourceRef))
    .limit(1);

  const grossSalary = options.grossSalary ?? settings.grossSalary;

  let targetWalletId = options.walletId ?? settings.defaultSalaryWalletId ?? null;
  if (!targetWalletId) {
    const allWallets = await db.select().from(wallets).where(eq(wallets.isActive, true));
    const bank = allWallets.find((w) => w.type === "bank");
    const fallback =
      bank ??
      allWallets.find((w) => w.role === "spending") ??
      allWallets.find((w) => w.type !== "credit_card");
    targetWalletId = fallback?.id ?? null;
  }

  const gajianBounds = periodBounds(
    targetPeriod,
    "gajian",
    settings.gajianStartDay,
    settings.cardCutoffDay,
  );

  const payrollAccounts = await db
    .select()
    .from(debtAccounts)
    .where(eq(debtAccounts.kind, "payroll"));
  const payrollAccountMap = new Map(payrollAccounts.map((a) => [a.id, a]));
  const payrollAccountIds = payrollAccounts.map((a) => a.id);

  let upcomingPayrollInstallments: Array<
    typeof installments.$inferSelect & { accountName: string; lender: string }
  > = [];

  if (payrollAccountIds.length > 0) {
    const allPayrollInstallments = await db
      .select()
      .from(installments)
      .where(inArray(installments.accountId, payrollAccountIds));
    const activeIds = filterActiveInstallmentIds(payrollAccounts, allPayrollInstallments);

    upcomingPayrollInstallments = allPayrollInstallments
      .filter((inst) => {
        if (!activeIds.has(inst.id)) return false;
        const acc = payrollAccountMap.get(inst.accountId);
        if (!acc) return false;
        const instPeriod = gajianPeriodForDate(inst.dueDate, settings.gajianStartDay);
        if (instPeriod !== targetPeriod) return false;
        // Include rows auto-marked paid by payday sync (settlementTransactionId === null) so deductions are not skipped.
        const isUnsettledUpcoming = inst.status === "upcoming" && acc.closedAt == null;
        const isAutoSyncedUnlinked = inst.status === "paid" && inst.settlementTransactionId === null;
        return isUnsettledUpcoming || isAutoSyncedUnlinked;
      })
      .map((inst) => {
        const acc = payrollAccountMap.get(inst.accountId);
        return {
          ...inst,
          plannedAmount: inst.actualAmount ?? inst.plannedAmount,
          accountName: acc?.name ?? "Utang Kantor",
          lender: acc?.lender ?? "Kantor",
        };
      });
  }

  const totalPayrollDue = upcomingPayrollInstallments.reduce(
    (sum, inst) => sum + inst.plannedAmount,
    0,
  );
  const netSalary = Math.max(0, grossSalary - totalPayrollDue);

  return {
    period: targetPeriod,
    periodStart: gajianBounds.start,
    periodEnd: gajianBounds.end,
    grossSalary,
    totalPayrollDue,
    netSalary,
    targetWalletId,
    alreadyReceived: existing.length > 0,
    existingTransactionId: existing[0]?.id ?? null,
    payrollInstallments: upcomingPayrollInstallments.map((i) => ({
      id: i.id,
      accountId: i.accountId,
      accountName: i.accountName,
      lender: i.lender,
      dueDate: i.dueDate,
      plannedAmount: i.plannedAmount,
    })),
  };
}

export async function receiveSalaryForPeriod(
  db: AppDb,
  input: {
    period?: string;
    grossSalary?: number;
    walletId?: number;
    transactionDate?: string;
  } = {},
  today = jakartaToday(),
) {
  const preview = await getSalaryPreview(db, input, today);
  if (preview.alreadyReceived) {
    throw new ConflictError(`Gaji untuk periode ${preview.period} sudah dicatat.`);
  }

  const grossSalary = input.grossSalary ?? preview.grossSalary;
  if (grossSalary <= 0) {
    throw new ValidationError("Gaji kotor harus lebih dari 0.");
  }
  if (grossSalary <= preview.totalPayrollDue) {
    throw new ValidationError(
      `Gaji kotor (Rp${grossSalary.toLocaleString("id-ID")}) harus lebih besar dari total potongan cicilan kantor (Rp${preview.totalPayrollDue.toLocaleString("id-ID")}).`,
    );
  }

  const targetWalletId = input.walletId ?? preview.targetWalletId;
  if (!targetWalletId) {
    throw new NotFoundError("Dompet penerima gaji tidak ditemukan.");
  }

  const [targetWallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.id, targetWalletId))
    .limit(1);

  if (!targetWallet?.isActive) {
    throw new NotFoundError("Dompet penerima gaji tidak ditemukan atau tidak aktif.");
  }
  if (targetWallet.type === "credit_card") {
    throw new ValidationError("Gaji tidak dapat dicatat ke dompet kartu kredit.");
  }

  const transactionDate = input.transactionDate ?? preview.periodStart;
  const netSalary = grossSalary - preview.totalPayrollDue;
  const sourceRef = `salary-${preview.period}`;

  const catRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, "Gaji"), eq(categories.type, "income")))
    .limit(1);
  const categoryId = catRows[0]?.id ?? null;

  const note =
    preview.totalPayrollDue > 0
      ? `Gaji kotor: Rp${grossSalary.toLocaleString("id-ID")}, Potongan cicilan kantor: Rp${preview.totalPayrollDue.toLocaleString("id-ID")}`
      : "Pencatatan gaji bulanan";

  const createdTx = await db.transaction(async (tx) => {
    await lockLedger(tx);

    // The preview was computed before the lock. Abort if a payroll installment was settled
    // by another request in the meantime, otherwise it would be paid twice.
    const previewInstIds = preview.payrollInstallments.map((i) => i.id);
    if (previewInstIds.length > 0) {
      const current = await tx
        .select({
          id: installments.id,
          status: installments.status,
          settlementTransactionId: installments.settlementTransactionId,
        })
        .from(installments)
        .where(inArray(installments.id, previewInstIds));
      const changed = current.some((row) => row.settlementTransactionId !== null);
      if (changed || current.length !== previewInstIds.length) {
        throw new ConflictError("Data cicilan kantor berubah. Muat ulang lalu coba lagi.");
      }
    }
    const [inserted] = await tx
      .insert(transactions)
      .values({
        type: "income",
        merchant: "Gaji Kantor",
        amount: netSalary,
        transactionDate,
        category: "Gaji",
        categoryId,
        walletId: targetWalletId,
        source: "system",
        sourceRef,
        note,
      })
      .onConflictDoNothing({ target: transactions.sourceRef })
      .returning();

    if (!inserted) {
      throw new ConflictError(`Gaji untuk periode ${preview.period} sudah dicatat.`);
    }

    for (const inst of preview.payrollInstallments) {
      await tx
        .update(installments)
        .set({
          status: "paid",
          actualAmount: inst.plannedAmount,
          paidAt: sql`COALESCE(${installments.paidAt}, NOW())`,
          settlementTransactionId: inserted.id,
        })
        .where(eq(installments.id, inst.id));

      await tx
        .insert(settlementAllocations)
        .values({
          settlementTransactionId: inserted.id,
          targetType: "installment",
          installmentId: inst.id,
          allocatedAmount: inst.plannedAmount,
        });
    }

    const affectedAccountIds = [...new Set(preview.payrollInstallments.map((i) => i.accountId))];
    await closeAccountsIfFullyPaid(tx, affectedAccountIds, {
      action: "auto_close_payroll",
      resolveClosedAt: (paidRows) => {
        let latestPaidAt: Date | null = null;
        for (const row of paidRows) {
          if (row.paidAt && (!latestPaidAt || row.paidAt > latestPaidAt)) {
            latestPaidAt = row.paidAt;
          }
        }
        return latestPaidAt ?? new Date(`${transactionDate}T00:00:00.000Z`);
      },
    });

    await recordAuditLog(tx, {
      entityType: "salary",
      entityId: inserted.id,
      action: "receive_salary",
      before: null,
      after: {
        period: preview.period,
        grossSalary,
        netSalary,
        totalPayrollDue: preview.totalPayrollDue,
        walletId: targetWalletId,
        paidInstallmentIds: preview.payrollInstallments.map((i) => i.id),
        transactionId: inserted.id,
      },
    });

    return inserted;
  });

  return {
    ok: true,
    period: preview.period,
    grossSalary,
    netSalary,
    totalPayrollDue: preview.totalPayrollDue,
    paidInstallmentsCount: preview.payrollInstallments.length,
    transaction: createdTx,
  };
}
