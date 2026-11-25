import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../app/server/src/db/index";
import {
  appSettings,
  assets,
  auditLogs,
  budgets,
  debtAccounts,
  goals,
  installments,
  recurringRules,
  settlementAllocations,
  transactionSplits,
  transactions,
  walletRecurringFees,
  wallets,
} from "../app/server/src/db/schema";

const TABLES_TO_RESET = [
  "settlement_allocations",
  "transaction_splits",
  "transactions",
  "installments",
  "debt_accounts",
  "goals",
  "assets",
  "budgets",
  "recurring_rules",
  "wallet_recurring_fees",
  "audit_logs",
  "wallets",
] as const;

const { db } = getDb();

try {
  await db.transaction(async (tx) => {
    await tx.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
    await tx
      .update(appSettings)
      .set({
        grossSalary: 0,
        netSalary: 0,
        payrollDeduction: 0,
        defaultSalaryWalletId: null,
        cardLimit: 0,
        cardCutoffDay: 20,
        cardPaymentDay: 25,
        statementDay: 21,
        legacySettledBeforeCycle: null,
        lastAutoSyncDate: null,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, 1));

    await tx.delete(settlementAllocations);
    await tx.delete(transactionSplits);
    await tx.delete(transactions);
    await tx.delete(installments);
    await tx.delete(debtAccounts);
    await tx.delete(goals);
    await tx.delete(assets);
    await tx.delete(budgets);
    await tx.delete(recurringRules);
    await tx.delete(walletRecurringFees);
    await tx.delete(auditLogs);
    await tx.delete(wallets);

    for (const tableName of TABLES_TO_RESET) {
      await tx.execute(
        sql.raw(`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), 1, false)`),
      );
    }
  });

  const [remainingWallets, txRows, debtRows, goalRows, assetRows, budgetRows] = await Promise.all([
    db.select().from(wallets),
    db.select().from(transactions),
    db.select().from(debtAccounts),
    db.select().from(goals),
    db.select().from(assets),
    db.select().from(budgets),
  ]);

  console.log("=== RESET SUMMARY ===");
  console.log(
    "Remaining Wallets:",
    remainingWallets.map((w) => `${w.name} (Saldo: ${w.openingBalance})`),
  );
  console.log("Transactions Count:", txRows.length);
  console.log("Debts Count:", debtRows.length);
  console.log("Goals Count:", goalRows.length);
  console.log("Assets Count:", assetRows.length);
  console.log("Budgets Count:", budgetRows.length);
  console.log("Database reset completed successfully!");
} finally {
  await closeDb();
}
