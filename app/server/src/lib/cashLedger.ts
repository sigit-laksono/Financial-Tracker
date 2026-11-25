import { and, eq, or, sql } from "drizzle-orm";
import type { AppDb } from "../db";
import { categories, transactions, wallets } from "../db/schema";
import { recordAuditLog } from "./auditService";
import { jakartaToday } from "./dates";
import { NotFoundError, ValidationError } from "./errors";
import { lockLedger } from "./ledgerLock";

export type TxOrDb = AppDb | Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export async function computeWalletBalance(
  tx: TxOrDb,
  walletId: number,
  openingBalance: number,
): Promise<number> {
  const [row] = await tx
    .select({
      inflow: sql<number>`COALESCE(SUM(CASE 
        WHEN ${transactions.walletId} = ${walletId} AND ${transactions.type} IN ('income', 'adjustment', 'debt_collection', 'loan_disbursement') THEN ${transactions.amount}
        WHEN ${transactions.toWalletId} = ${walletId} AND ${transactions.type} = 'transfer' THEN ${transactions.amount}
        ELSE 0 
      END), 0)`,
      outflow: sql<number>`COALESCE(SUM(CASE 
        WHEN ${transactions.walletId} = ${walletId} AND ${transactions.type} IN ('expense', 'settlement', 'transfer', 'debt_disbursement') THEN ${transactions.amount}
        ELSE 0 
      END), 0)`,
    })
    .from(transactions)
    .where(or(eq(transactions.walletId, walletId), eq(transactions.toWalletId, walletId)));

  return openingBalance + Number(row?.inflow ?? 0) - Number(row?.outflow ?? 0);
}

export async function createTransferWithOptionalFee(
  db: AppDb,
  input: {
    fromWalletId: number;
    toWalletId: number;
    amount: number;
    adminFee?: number;
    transactionDate: string;
    merchant?: string;
    note?: string;
    preventOverdraft?: boolean;
  },
) {
  if (input.fromWalletId === input.toWalletId) {
    throw new ValidationError("Dompet asal dan tujuan tidak boleh sama.");
  }
  return await db.transaction(async (tx) => {
    await lockLedger(tx);
    const [srcWallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.fromWalletId))
      .limit(1);
    const [dstWallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.toWalletId))
      .limit(1);
    if (!srcWallet || !dstWallet) throw new NotFoundError("Dompet tidak ditemukan.");
    if (srcWallet.type === "credit_card" || dstWallet.type === "credit_card") {
      throw new ValidationError("Transfer hanya berlaku antar dompet kas, bank, atau e-wallet.");
    }

    if (input.preventOverdraft) {
      const totalTransferNeeded = input.amount + (input.adminFee ?? 0);
      const srcBalance = await computeWalletBalance(tx, srcWallet.id, srcWallet.openingBalance);
      if (srcBalance < totalTransferNeeded) {
        throw new ValidationError(
          `Saldo dompet ${srcWallet.name} tidak mencukupi untuk transfer (Saldo: Rp${srcBalance.toLocaleString("id-ID")}, Dibutuhkan: Rp${totalTransferNeeded.toLocaleString("id-ID")}).`,
        );
      }
    }

    const transferGroupId = crypto.randomUUID();
    const label = input.merchant?.trim() || `Transfer ke ${dstWallet.name}`;
    const [transferRow] = await tx
      .insert(transactions)
      .values({
        type: "transfer",
        merchant: label,
        amount: input.amount,
        transactionDate: input.transactionDate,
        category: "Transfer",
        categoryId: null,
        walletId: srcWallet.id,
        toWalletId: dstWallet.id,
        transferGroupId,
        note: input.note?.trim() || null,
        source: "manual",
      })
      .returning({ id: transactions.id });

    let feeTransactionId: number | null = null;
    if (input.adminFee && input.adminFee > 0) {
      const [feeCategory] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.type, "expense"), eq(categories.name, "Biaya Bank")))
        .limit(1);

      const [feeRow] = await tx
        .insert(transactions)
        .values({
          type: "expense",
          merchant: `Biaya admin transfer ke ${dstWallet.name}`,
          amount: input.adminFee,
          transactionDate: input.transactionDate,
          category: "Biaya Bank",
          categoryId: feeCategory?.id ?? null,
          walletId: srcWallet.id,
          transferGroupId,
          note: `Biaya admin untuk transfer Rp${input.amount.toLocaleString("id-ID")}`,
          source: "manual",
        })
        .returning({ id: transactions.id });
      feeTransactionId = feeRow?.id ?? null;
    }

    return { transferId: transferRow!.id, feeTransactionId, transferGroupId };
  });
}

export async function reconcileWalletBalance(
  db: AppDb,
  input: { walletId: number; actualBalance: number; date?: string; note?: string },
) {
  const txDate = input.date ?? jakartaToday();
  return await db.transaction(async (tx) => {
    await lockLedger(tx);
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, input.walletId)).limit(1);
    if (!wallet) throw new NotFoundError("Dompet tidak ditemukan.");
    if (wallet.type === "credit_card") {
      throw new ValidationError("Rekonsiliasi saldo hanya untuk dompet kas, bank, atau e-wallet.");
    }

    const currentBalance = await computeWalletBalance(tx, wallet.id, wallet.openingBalance);

    const delta = input.actualBalance - currentBalance;
    if (delta === 0) {
      return { adjusted: false, delta: 0, transactionId: null };
    }

    const [inserted] = await tx
      .insert(transactions)
      .values({
        type: "adjustment",
        merchant: `Penyesuaian Saldo ${wallet.name}`,
        amount: delta,
        transactionDate: txDate,
        category: "Penyesuaian Saldo",
        categoryId: null,
        walletId: wallet.id,
        note:
          input.note?.trim() ||
          `Saldo sistem Rp${currentBalance.toLocaleString("id-ID")} disesuaikan ke Rp${input.actualBalance.toLocaleString("id-ID")}`,
        source: "manual",
      })
      .returning({ id: transactions.id });

    await recordAuditLog(tx, {
      entityType: "wallet",
      entityId: wallet.id,
      action: "reconcile",
      before: { balance: currentBalance },
      after: { balance: input.actualBalance, delta, transactionId: inserted?.id ?? null },
    });

    return { adjusted: true, delta, transactionId: inserted?.id ?? null };
  });
}
