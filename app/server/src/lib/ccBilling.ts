import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { AppDb } from "../db";
import {
  categories,
  settlementAllocations,
  transactions,
  walletRecurringFees,
  wallets,
} from "../db/schema";
import { periodBounds } from "./dates";
import { getSettings } from "./settingsService";

export const DEFAULT_BANK_FEES = [
  { key: "materai", merchant: "Materai", amount: 10_000 },
  { key: "notifikasi", merchant: "Notifikasi", amount: 12_500 },
] as const;

export async function ensureMonthlyBankFees(
  db: AppDb,
  cycleKey: string,
  options: { requireActivityForWallets?: boolean } = {},
): Promise<number> {
  const allCcWallets = await db.select().from(wallets).where(eq(wallets.type, "credit_card"));
  const ccWallets = allCcWallets.filter((w) => w.isActive);
  if (ccWallets.length === 0) return 0;

  const settings = await getSettings(db);
  if (settings.legacySettledBeforeCycle && cycleKey <= settings.legacySettledBeforeCycle) {
    return 0;
  }

  const isSingleCc = allCcWallets.length <= 1;

  const [bankFeeCategory] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.type, "expense"), eq(categories.name, "Biaya Bank")))
    .limit(1);

  let totalInserted = 0;

  for (const ccWallet of ccWallets) {
    const cutoffDay = ccWallet.cutoffDay ?? settings.cardCutoffDay;
    const feeDate = periodBounds(cycleKey, "cc", settings.gajianStartDay, cutoffDay).end;

    const existingRows = await db
      .select({
        type: transactions.type,
        merchant: transactions.merchant,
        amount: transactions.amount,
        source: transactions.source,
        sourceRef: transactions.sourceRef,
        isConvertedToInstallment: transactions.isConvertedToInstallment,
      })
      .from(transactions)
      .where(and(eq(transactions.walletId, ccWallet.id), eq(transactions.ccCycleKey, cycleKey)));

    const [allocRow, settlementTxRows, allWalletFees] = await Promise.all([
      db
        .select({
          total: sql<number>`COALESCE(SUM(${settlementAllocations.allocatedAmount}), 0)`,
        })
        .from(settlementAllocations)
        .where(
          and(
            eq(settlementAllocations.targetType, "cc_cycle"),
            eq(settlementAllocations.ccCycleKey, cycleKey),
            isSingleCc
              ? or(
                  eq(settlementAllocations.ccWalletId, ccWallet.id),
                  isNull(settlementAllocations.ccWalletId),
                )
              : eq(settlementAllocations.ccWalletId, ccWallet.id),
          ),
        ),
      db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.type, "settlement"),
            eq(transactions.ccCycleKey, cycleKey),
            isSingleCc
              ? or(eq(transactions.toWalletId, ccWallet.id), isNull(transactions.toWalletId))
              : eq(transactions.toWalletId, ccWallet.id),
          ),
        )
        .limit(1),
      db
        .select()
        .from(walletRecurringFees)
        .where(eq(walletRecurringFees.walletId, ccWallet.id)),
    ]);

    const settledAmount = Number(allocRow[0]?.total ?? 0);
    const hasSettlementTx = settlementTxRows.length > 0;
    const dailySpend = existingRows
      .filter((r) => r.type === "expense" && !r.isConvertedToInstallment)
      .reduce((sum, r) => sum + r.amount, 0);

    // Do not insert fees into an already-settled cycle or an untouched prior cycle lookback.
    if ((settledAmount > 0 && dailySpend <= settledAmount) || hasSettlementTx) {
      continue;
    }
    if (options.requireActivityForWallets && existingRows.length === 0) {
      continue;
    }

    // Only fall back to DEFAULT_BANK_FEES when zero fee rows exist; disabling all rows yields Rp 0.
    const activeFees =
      allWalletFees.length > 0
        ? allWalletFees
            .filter((f) => f.isActive)
            .map((f) => ({
              id: f.id,
              key: `fee-${f.id}`,
              merchant: f.name,
              amount: f.amount,
            }))
        : DEFAULT_BANK_FEES.map((f) => ({
            id: null,
            key: f.key,
            merchant: f.merchant,
            amount: f.amount,
          }));

    if (activeFees.length === 0) continue;

    for (const fee of activeFees) {
      // Support both new wallet-scoped sourceRef and legacy sourceRef
      const scopedSourceRef = `auto-fee-${ccWallet.id}-${cycleKey}-${fee.key}`;
      const legacySourceRef = `auto-fee-${cycleKey}-${fee.key}`;

      const exists = existingRows.some(
        (r) =>
          r.sourceRef === scopedSourceRef ||
          r.sourceRef === legacySourceRef ||
          (r.merchant.trim().toLowerCase() === fee.merchant.toLowerCase() &&
            (r.source === "system" || r.amount === fee.amount)),
      );
      if (exists) continue;

      const inserted = await db
        .insert(transactions)
        .values({
          type: "expense",
          merchant: fee.merchant,
          amount: fee.amount,
          transactionDate: feeDate,
          category: "Biaya Bank",
          categoryId: bankFeeCategory?.id ?? null,
          walletId: ccWallet.id,
          note: "Biaya bank dari statement, tercatat otomatis",
          ccCycleKey: cycleKey,
          source: "system",
          sourceRef: scopedSourceRef,
        })
        .onConflictDoNothing()
        .returning({ id: transactions.id });

      if (inserted.length > 0) {
        totalInserted += 1;
      }
    }
  }

  return totalInserted;
}
