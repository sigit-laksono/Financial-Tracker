/**
 * Amount an account must be paid before it counts as settled: the larger of the stated
 * balance and the sum of every scheduled installment (which includes interest, if any).
 * Auto-close, auto-reopen and active-row filtering must all use this.
 */
export function debtTargetObligation(initialBalance: number, plannedTotal: number): number {
  return Math.max(initialBalance, plannedTotal);
}

type InstallmentLike = {
  status: string;
  plannedAmount: number;
  actualAmount: number | null;
  principalAmount: number | null;
};

/**
 * Outstanding principal of a debt account. `initialBalance` is the principal; each paid
 * installment repays only its principal share, not the interest inside it.
 *
 * When the schedule's principal adds up to more than `initialBalance` (installments entered
 * without a principal/interest split, e.g. 12 x 1jt for a 10jt loan), the difference is
 * treated as interest spread evenly over the schedule. That way the remaining principal only
 * reaches 0 together with the last scheduled payment, which is also when the account closes.
 */
export function remainingPrincipal(initialBalance: number, rows: InstallmentLike[]): number {
  const scheduledPrincipal = rows.reduce(
    (sum, row) => sum + (row.principalAmount ?? row.plannedAmount),
    0,
  );
  const scale =
    scheduledPrincipal > initialBalance && scheduledPrincipal > 0
      ? initialBalance / scheduledPrincipal
      : 1;

  let principalPaid = 0;
  for (const row of rows) {
    if (row.status !== "paid") continue;
    const actual = row.actualAmount ?? row.plannedAmount;
    const principal = row.principalAmount ?? row.plannedAmount;
    // Paid more or less than planned (custom amount, proportional allocation): scale the share.
    const share = row.plannedAmount > 0 ? actual / row.plannedAmount : 1;
    principalPaid += principal * share * scale;
  }
  return Math.max(0, Math.round(initialBalance - principalPaid));
}
