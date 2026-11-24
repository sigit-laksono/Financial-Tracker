import { and, eq, inArray } from "drizzle-orm";
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
import { ConflictError, NotFoundError, ValidationError } from "./errors";
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

    upcomingPayrollInstallments = allPayrollInstallments
      .filter(
        (inst) =>
          inst.status === "upcoming" &&
          (inst.period === targetPeriod ||
            (inst.dueDate >= gajianBounds.start && inst.dueDate <= gajianBounds.end)),
      )
      .map((inst) => {
        const acc = payrollAccountMap.get(inst.accountId);
        return {
          ...inst,
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
  const netSalary = Math.max(0, grossSalary - preview.totalPayrollDue);
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
      .returning();

    if (!inserted) {
      throw new Error("Gagal membuat transaksi penerimaan gaji.");
    }

    for (const inst of preview.payrollInstallments) {
      await tx
        .update(installments)
        .set({
          status: "paid",
          actualAmount: inst.plannedAmount,
          paidAt: new Date(),
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
