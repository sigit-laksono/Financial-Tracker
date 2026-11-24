import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { APP_ROOT, getDb } from "./index";
import { debtAccounts, installments, transactions, wallets } from "./schema";

const { db, client } = getDb();

type ExportJson = {
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  totalIncomeMinor: number;
  totalExpenseMinor: number;
  surplusMinor: number;
  cashBalanceMinor: number;
};

async function audit(): Promise<void> {
  const accountRows = await db.select().from(debtAccounts);
  const installmentRows = await db.select().from(installments);
  const txRows = await db.select().from(transactions);
  const walletRows = await db.select().from(wallets);

  // Match Debt Management active-installment cap: ignore rows past the one that settles initialBalance.
  let initialDebt = 0;
  let paidDebt = 0;
  for (const account of accountRows) {
    initialDebt += account.initialBalance;
    const rows = installmentRows
      .filter((r) => r.accountId === account.id)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
    let runningPaid = 0;
    for (const row of rows) {
      if (runningPaid >= account.initialBalance) break;
      if (row.status === "paid") {
        runningPaid += row.actualAmount ?? row.plannedAmount;
      }
    }
    paidDebt += runningPaid;
  }
  const remainingDebt = Math.max(0, initialDebt - paidDebt);

  const ccWallet = walletRows.find((w) => w.key === "cc-jenius");
  const mmExportPath = resolve(
    APP_ROOT,
    "../money-management/data/transactions-2026-10-gajian.json",
  );

  console.log("=== Debt Audit ===");
  console.log(`Accounts: ${accountRows.length}`);
  console.log(`Installments: ${installmentRows.length}`);
  console.log(`Initial Debt: ${initialDebt}`);
  console.log(`Paid Debt: ${paidDebt}`);
  console.log(`Remaining Debt: ${remainingDebt}`);

  console.log("\n=== Transaction Audit ===");
  console.log(`Total unified transactions: ${txRows.length}`);

  if (existsSync(mmExportPath)) {
    const mmExport = JSON.parse(readFileSync(mmExportPath, "utf8")) as ExportJson;
    const cycleRows = txRows.filter(
      (t) => t.transactionDate >= mmExport.periodStart && t.transactionDate <= mmExport.periodEnd,
    );
    let income = 0;
    let expense = 0;
    let cashOut = 0;
    for (const row of cycleRows) {
      if (row.type === "income") income += row.amount;
      else if (row.type === "settlement") cashOut += row.amount;
      else if (row.type === "expense") {
        expense += row.amount;
        if (row.walletId !== ccWallet?.id) cashOut += row.amount;
      }
    }
    const surplus = income - expense;
    const cashBalance = income - cashOut;

    console.log(`\nCycle ${mmExport.periodStart}..${mmExport.periodEnd}:`);
    console.log(
      `- Transactions: ${cycleRows.length} (legacy export had ${mmExport.transactionCount})`,
    );
    console.log(`- Income: ${income} (legacy ${mmExport.totalIncomeMinor})`);
    console.log(`- Expense: ${expense} (legacy ${mmExport.totalExpenseMinor})`);
    console.log(`- Surplus: ${surplus} (legacy ${mmExport.surplusMinor})`);
    console.log(`- Cash Balance: ${cashBalance} (legacy ${mmExport.cashBalanceMinor})`);

    if (
      cycleRows.length !== mmExport.transactionCount ||
      income !== mmExport.totalIncomeMinor ||
      expense !== mmExport.totalExpenseMinor ||
      cashBalance !== mmExport.cashBalanceMinor
    ) {
      throw new Error(`Cycle ${mmExport.periodStart}..${mmExport.periodEnd} totals diverged from legacy export.`);
    }
  }

  const expectedInitialDebt = process.env.EXPECTED_INITIAL_DEBT
    ? Number(process.env.EXPECTED_INITIAL_DEBT)
    : null;
  const expectedRemainingDebt = process.env.EXPECTED_REMAINING_DEBT
    ? Number(process.env.EXPECTED_REMAINING_DEBT)
    : null;
  const expectedTxCount = process.env.EXPECTED_TX_COUNT
    ? Number(process.env.EXPECTED_TX_COUNT)
    : null;

  if (expectedInitialDebt !== null && initialDebt !== expectedInitialDebt) {
    throw new Error(`Initial debt mismatch: expected ${expectedInitialDebt}, got ${initialDebt}.`);
  }
  if (expectedRemainingDebt !== null && remainingDebt !== expectedRemainingDebt) {
    throw new Error(
      `Remaining debt mismatch: expected ${expectedRemainingDebt}, got ${remainingDebt}.`,
    );
  }
  if (expectedTxCount !== null && txRows.length !== expectedTxCount) {
    throw new Error(`Expected ${expectedTxCount} unified transactions, got ${txRows.length}.`);
  }

  const ccCycleCounts = await db
    .select()
    .from(transactions)
    .where(eq(transactions.walletId, ccWallet?.id ?? -1));
  console.log(`CC total rows across all cycles: ${ccCycleCounts.length}`);
  console.log("\nAUDIT PASSED.");
  await client.end();
}

audit().catch(async (err) => {
  console.error("Audit failed:", err);
  await client.end();
  process.exit(1);
});
