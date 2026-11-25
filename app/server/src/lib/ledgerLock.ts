import { sql } from "drizzle-orm";
import type { AppTransaction } from "../db";

// Arbitrary fixed key for the app-wide ledger advisory lock.
const LEDGER_LOCK_KEY = 7_311_204_001;

/**
 * Serializes money-moving writes (balance/limit checks followed by inserts, installment
 * settlement) so concurrent requests such as a double-submit cannot both pass the same
 * check. Held until the surrounding transaction commits or rolls back. Must be called on
 * the transaction handle, never on the pool, and never while another transaction on a
 * different connection is expected to take the same lock (that would deadlock).
 */
export async function lockLedger(tx: AppTransaction): Promise<void> {
  await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_KEY}::bigint)`));
}
