import { getDb } from "../app/server/src/db/index";
import { wallets, transactions, debtAccounts, installments, goals, assets, budgets, appSettings } from "../app/server/src/db/schema";

const { sqlite, db } = getDb();

sqlite.exec("PRAGMA foreign_keys = OFF;");

sqlite.exec("DELETE FROM settlement_allocations;");
sqlite.exec("DELETE FROM transaction_splits;");
sqlite.exec("DELETE FROM transactions;");
sqlite.exec("DELETE FROM installments;");
sqlite.exec("DELETE FROM debt_accounts;");
sqlite.exec("DELETE FROM goals;");
sqlite.exec("DELETE FROM assets;");
sqlite.exec("DELETE FROM budgets;");
sqlite.exec("DELETE FROM recurring_rules;");
sqlite.exec("DELETE FROM wallet_recurring_fees;");
sqlite.exec("DELETE FROM audit_logs;");

sqlite.exec(`DELETE FROM sqlite_sequence WHERE name IN (
  'settlement_allocations', 'transaction_splits', 'transactions',
  'installments', 'debt_accounts', 'goals', 'assets', 'budgets',
  'recurring_rules', 'wallet_recurring_fees', 'audit_logs'
);`);

sqlite.exec("DELETE FROM wallets;");
sqlite.exec("DELETE FROM sqlite_sequence WHERE name = 'wallets';");

sqlite.exec(`
  UPDATE app_settings SET
    gross_salary = 0,
    net_salary = 0,
    payroll_deduction = 0,
    default_salary_wallet_id = NULL,
    card_limit = 0,
    card_cutoff_day = 20,
    card_payment_day = 25,
    statement_day = 21,
    legacy_settled_before_cycle = NULL
  WHERE id = 1;
`);

sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("VACUUM;");

const remainingWallets = await db.select().from(wallets);
const txCount = (await db.select().from(transactions)).length;
const debtCount = (await db.select().from(debtAccounts)).length;
const goalCount = (await db.select().from(goals)).length;
const assetCount = (await db.select().from(assets)).length;
const budgetCount = (await db.select().from(budgets)).length;

console.log("=== RESET SUMMARY ===");
console.log("Remaining Wallets:", remainingWallets.map(w => `${w.name} (Saldo: ${w.openingBalance})`));
console.log("Transactions Count:", txCount);
console.log("Debts Count:", debtCount);
console.log("Goals Count:", goalCount);
console.log("Assets Count:", assetCount);
console.log("Budgets Count:", budgetCount);
console.log("Database reset completed successfully!");
