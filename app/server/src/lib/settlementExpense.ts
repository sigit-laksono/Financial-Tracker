import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db";
import { settlementAllocations } from "../db/schema";

type DbOrTx = Pick<AppDb, "select">;

/**
 * Sums settlement_allocations targeted to "cc_cycle" (already counted as daily CC expenses)
 * keyed by settlementTransactionId, so installment settlements can be counted without double-counting.
 */
export async function getCcCycleAllocatedByTxId(
  db: DbOrTx,
  settlementTxIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (settlementTxIds.length === 0) return map;

  const rows = await db
    .select({
      settlementTransactionId: settlementAllocations.settlementTransactionId,
      allocatedAmount: settlementAllocations.allocatedAmount,
    })
    .from(settlementAllocations)
    .where(
      and(
        inArray(settlementAllocations.settlementTransactionId, settlementTxIds),
        eq(settlementAllocations.targetType, "cc_cycle"),
      ),
    );

  for (const row of rows) {
    map.set(
      row.settlementTransactionId,
      (map.get(row.settlementTransactionId) ?? 0) + row.allocatedAmount,
    );
  }
  return map;
}

/**
 * Returns the portion of a "settlement" transaction that pays debt/card installments
 * rather than daily credit card spending (cc_cycle).
 */
export function computeSettlementExpenseAmount(
  tx: {
    id: number;
    type: string;
    amount: number;
    ccCycleKey: string | null;
    installmentId: number | null;
  },
  ccCycleAllocatedByTxId: Map<number, number>,
): number {
  if (tx.type !== "settlement") return 0;
  const ccCycleAllocated = ccCycleAllocatedByTxId.get(tx.id);
  if (ccCycleAllocated !== undefined) {
    return Math.max(0, tx.amount - ccCycleAllocated);
  }
  // Legacy pure CC-daily settlement without allocation rows
  if (tx.ccCycleKey && tx.installmentId === null) {
    return 0;
  }
  return tx.amount;
}

/**
 * Resolves the canonical expense category name for debt installment settlements,
 * mapping legacy "Hutang" labels into "Cicilan & Hutang" when present.
 */
export function resolveDebtExpenseCategoryName(
  txCategory: string,
  categoryRows: Array<{ name: string; type: string }>,
): string {
  const canonicalInstallmentCat = categoryRows.find(
    (c) => c.type === "expense" && c.name.trim().toLowerCase() === "cicilan & hutang",
  );
  if (canonicalInstallmentCat) {
    const normalized = txCategory.trim().toLowerCase();
    if (normalized === "hutang" || normalized === "cicilan & hutang" || normalized === "pinjaman") {
      return canonicalInstallmentCat.name;
    }
  }
  return txCategory;
}
