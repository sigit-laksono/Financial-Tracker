import { and, eq } from "drizzle-orm";
import type { AppDb } from "../db";
import { categories, transactions, walletRecurringFees, wallets } from "../db/schema";
import { periodBounds } from "./dates";
import { getSettings } from "./settingsService";

export const DEFAULT_BANK_FEES = [
  { key: "materai", merchant: "Materai", amount: 10_000 },
  { key: "notifikasi", merchant: "Notifikasi", amount: 12_500 },
] as const;

export async function ensureMonthlyBankFees(db: AppDb, cycleKey: string): Promise<number> {
  const ccWallets = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.type, "credit_card"), eq(wallets.isActive, true)));
  if (ccWallets.length === 0) return 0;

  const settings = await getSettings(db);

  const [bankFeeCategory] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.type, "expense"), eq(categories.name, "Biaya Bank")))
    .limit(1);

  let totalInserted = 0;

  for (const ccWallet of ccWallets) {
    const cutoffDay = ccWallet.cutoffDay ?? settings.cardCutoffDay;
    const feeDate = periodBounds(cycleKey, "cc", settings.gajianStartDay, cutoffDay).end;

    // Fetch recurring fees configured for this wallet
    const fees = await db
      .select()
      .from(walletRecurringFees)
      .where(
        and(eq(walletRecurringFees.walletId, ccWallet.id), eq(walletRecurringFees.isActive, true)),
      );

    const activeFees =
      fees.length > 0
        ? fees.map((f) => ({
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

    const existingRows = await db
      .select({
        merchant: transactions.merchant,
        amount: transactions.amount,
        source: transactions.source,
        sourceRef: transactions.sourceRef,
      })
      .from(transactions)
      .where(and(eq(transactions.walletId, ccWallet.id), eq(transactions.ccCycleKey, cycleKey)));

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
