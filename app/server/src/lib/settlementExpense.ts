import { inArray } from "drizzle-orm";
import type { AppDb } from "../db";
import { settlementAllocations } from "../db/schema";

type DbOrTx = Pick<AppDb, "select">;

/**
 * Sums settlement_allocations targeted to "cc_cycle" (already counted as daily CC expenses)
 * keyed by settlementTransactionId, while also recording 0 for settlements that only have
 * installment allocations so legacy zero-return applies only when no allocation rows exist.
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
      targetType: settlementAllocations.targetType,
      allocatedAmount: settlementAllocations.allocatedAmount,
    })
    .from(settlementAllocations)
    .where(inArray(settlementAllocations.settlementTransactionId, settlementTxIds));

  for (const row of rows) {
    const prev = map.get(row.settlementTransactionId) ?? 0;
    const add = row.targetType === "cc_cycle" ? row.allocatedAmount : 0;
    map.set(row.settlementTransactionId, prev + add);
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
