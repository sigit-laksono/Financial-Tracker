import { eq, sql } from "drizzle-orm";
import type { AppTransaction } from "../db";
import { goals } from "../db/schema";

const GOAL_REF_PATTERN = /^goal:(\d+):/;

/** Goal id of a goal-contribution transfer (sourceRef `goal:<id>:...`), or null. */
export function goalIdFromSourceRef(sourceRef: string | null | undefined): number | null {
  const match = sourceRef ? GOAL_REF_PATTERN.exec(sourceRef) : null;
  return match ? Number(match[1]) : null;
}

/** Moves a goal's progress by `delta` (never below 0). */
export async function adjustGoalProgress(
  tx: AppTransaction,
  goalId: number,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  await tx
    .update(goals)
    .set({
      currentAmount: sql`GREATEST(0, ${goals.currentAmount} + ${delta})`,
      updatedAt: new Date(),
    })
    .where(eq(goals.id, goalId));
}

/**
 * Removes the progress that came from goal-contribution transfers about to be deleted, so a
 * goal never shows savings that no longer exist in any wallet. Earmarked contributions (no
 * transfer) are not transactions and are left untouched.
 */
export async function revertGoalContributions(
  tx: AppTransaction,
  rows: Array<{ type: string; amount: number; sourceRef: string | null }>,
): Promise<void> {
  const totals = new Map<number, number>();
  for (const row of rows) {
    if (row.type !== "transfer") continue;
    const goalId = goalIdFromSourceRef(row.sourceRef);
    if (goalId === null) continue;
    totals.set(goalId, (totals.get(goalId) ?? 0) + row.amount);
  }
  for (const [goalId, total] of totals) {
    await adjustGoalProgress(tx, goalId, -total);
  }
}
