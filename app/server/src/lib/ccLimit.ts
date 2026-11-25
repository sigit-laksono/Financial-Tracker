import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { AppDb } from "../db";
import {
  appSettings,
  debtAccounts,
  installments,
  settlementAllocations,
  transactions,
  wallets,
} from "../db/schema";
import { remainingPrincipal } from "./debtTarget";
import { ValidationError } from "./errors";

type DbOrTx = Pick<AppDb, "select">;

export interface CreditCardLimitStatus {
  walletId: number;
  walletName: string;
  creditLimit: number;
  dailyLimitUsed: number;
  installmentLimitUsed: number;
  limitUsed: number;
  availableLimit: number;
  unpaidByCycle: Map<string, number>;
}

/**
 * Computes real-time limit usage and remaining available limit for a credit card wallet,
 * combining unpaid daily cycle expenses and remaining card installment principals.
 */
export async function getCreditCardLimitStatus(
  db: DbOrTx,
  ccWalletId: number,
): Promise<CreditCardLimitStatus> {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.id, ccWalletId))
    .limit(1);

  if (!wallet || wallet.type !== "credit_card") {
    throw new ValidationError("Dompet kartu kredit tidak ditemukan.");
  }

  const [ccWalletRows, settingsRows] = await Promise.all([
    db.select({ id: wallets.id }).from(wallets).where(eq(wallets.type, "credit_card")),
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1),
  ]);

  const settings = settingsRows[0];
  const isSingleCc = ccWalletRows.length <= 1;
  const creditLimit = wallet.creditLimit ?? settings?.cardLimit ?? 20_000_000;
  const legacyCutoff = settings?.legacySettledBeforeCycle ?? null;

  const spendRows = await db
    .select({
      ccCycleKey: transactions.ccCycleKey,
      total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.walletId, ccWalletId),
        eq(transactions.type, "expense"),
        eq(transactions.isConvertedToInstallment, false),
        isNotNull(transactions.ccCycleKey),
      ),
    )
    .groupBy(transactions.ccCycleKey);

  const settledRows = await db
    .select({
      ccCycleKey: settlementAllocations.ccCycleKey,
      total: sql<number>`COALESCE(SUM(${settlementAllocations.allocatedAmount}), 0)`,
    })
    .from(settlementAllocations)
    .where(
      and(
        eq(settlementAllocations.targetType, "cc_cycle"),
        isNotNull(settlementAllocations.ccCycleKey),
        isSingleCc
          ? or(
              eq(settlementAllocations.ccWalletId, ccWalletId),
              isNull(settlementAllocations.ccWalletId),
            )
          : eq(settlementAllocations.ccWalletId, ccWalletId),
      ),
    )
    .groupBy(settlementAllocations.ccCycleKey);

  const settledByCycle = new Map<string, number>();
  for (const row of settledRows) {
    if (row.ccCycleKey) {
      settledByCycle.set(
        row.ccCycleKey,
        (settledByCycle.get(row.ccCycleKey) ?? 0) + Number(row.total ?? 0),
      );
    }
  }

  const unpaidByCycle = new Map<string, number>();
  let dailyLimitUsed = 0;
  for (const row of spendRows) {
    if (!row.ccCycleKey) continue;
    if (legacyCutoff && row.ccCycleKey <= legacyCutoff) {
      unpaidByCycle.set(row.ccCycleKey, 0);
      continue;
    }
    const spend = Number(row.total ?? 0);
    const settled = settledByCycle.get(row.ccCycleKey) ?? 0;
    const unpaid = Math.max(0, spend - settled);
    unpaidByCycle.set(row.ccCycleKey, unpaid);
    dailyLimitUsed += unpaid;
  }

  const cardInstAccounts = await db
    .select({
      id: debtAccounts.id,
      initialBalance: debtAccounts.initialBalance,
    })
    .from(debtAccounts)
    .where(
      and(
        eq(debtAccounts.kind, "card_installment"),
        isNull(debtAccounts.closedAt),
        isSingleCc
          ? or(eq(debtAccounts.walletId, ccWalletId), isNull(debtAccounts.walletId))
          : eq(debtAccounts.walletId, ccWalletId),
      ),
    );

  const accountIds = cardInstAccounts.map((a) => a.id);
  const instRows =
    accountIds.length > 0
      ? await db
          .select({
            accountId: installments.accountId,
            status: installments.status,
            plannedAmount: installments.plannedAmount,
            actualAmount: installments.actualAmount,
            principalAmount: installments.principalAmount,
          })
          .from(installments)
          .where(inArray(installments.accountId, accountIds))
      : [];

  let installmentLimitUsed = 0;
  for (const acc of cardInstAccounts) {
    installmentLimitUsed += remainingPrincipal(
      acc.initialBalance,
      instRows.filter((row) => row.accountId === acc.id),
    );
  }

  const limitUsed = dailyLimitUsed + installmentLimitUsed;
  const availableLimit = Math.max(0, creditLimit - limitUsed);

  return {
    walletId: wallet.id,
    walletName: wallet.name,
    creditLimit,
    dailyLimitUsed,
    installmentLimitUsed,
    limitUsed,
    availableLimit,
    unpaidByCycle,
  };
}
