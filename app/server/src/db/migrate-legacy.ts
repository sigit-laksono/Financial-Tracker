import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { and, eq } from "drizzle-orm";
import { ccCycleForDate } from "../../../shared/src/dates";
import { APP_ROOT, getDb } from "./index";
import {
  appSettings,
  categories,
  debtAccounts,
  installments,
  transactions,
  wallets,
} from "./schema";
import { ensureDefaultSeed } from "./seed";

const { db, client } = getDb();

type LegacyDebtAccount = {
  id: number;
  key: string;
  name: string;
  lender: string;
  kind: "loan" | "card_installment" | "payroll";
  initial_balance: number;
  payment_day: number | null;
  payment_method: string;
  color: string;
  created_at: number;
  closed_at: number | null;
};

type LegacyInstallment = {
  id: number;
  account_id: number;
  period: string;
  due_date: string;
  planned_amount: number;
  actual_amount: number | null;
  status: "upcoming" | "paid";
  paid_at: number | null;
};

type LegacyCardTx = {
  id: number;
  transaction_date: string;
  merchant: string;
  amount: number;
  category: string;
  note: string | null;
  cycle_key: string;
  created_at: number;
};

type LegacySettings = {
  id: number;
  gross_salary: number;
  net_salary: number;
  payroll_deduction: number;
  card_cutoff_day: number;
  statement_day: number;
  card_payment_day: number;
  card_limit: number;
};

type LegacyExpense = {
  id: number;
  merchant: string;
  amount_minor: number;
  currency: string;
  purchase_date: string;
  category: string;
  note: string | null;
  source: "manual" | "whatsapp";
  source_ref: string | null;
  created_at: number;
  updated_at: number;
  transaction_type: "expense" | "income";
  funding_source: string;
  is_cc_settlement: number;
};

function normalizeMerchant(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mapFundingSourceToWalletKey(fundingSource: string): string {
  const map: Record<string, string> = {
    BNI: "bni",
    BCA: "bca",
    BTPN: "btpn",
    GoPay: "gopay",
    DANA: "dana",
    Tunai: "tunai",
    "CC Jenius": "cc-jenius",
  };
  return map[fundingSource] ?? "bni";
}

async function migrate(): Promise<void> {
  const debtDbPath = resolve(APP_ROOT, "../debt-management/data/app.db");
  const moneyDbPath = resolve(APP_ROOT, "../money-management/data/app.db");

  if (!existsSync(debtDbPath) || !existsSync(moneyDbPath)) {
    throw new Error(`Legacy database not found. Checked:\n- ${debtDbPath}\n- ${moneyDbPath}`);
  }

  await ensureDefaultSeed(db);

  const debtDb = new Database(debtDbPath, { readonly: true });
  const moneyDb = new Database(moneyDbPath, { readonly: true });

  const walletRows = await db.select().from(wallets);
  const walletByKey = new Map(walletRows.map((w) => [w.key, w]));
  const ccWallet = walletByKey.get("cc-jenius");
  const bniWallet = walletByKey.get("bni");
  if (!ccWallet || !bniWallet) {
    throw new Error("Default wallets (cc-jenius / bni) missing after seed.");
  }

  // 1. Settings
  const legacySettings = debtDb
    .query("SELECT * FROM settings LIMIT 1")
    .get() as LegacySettings | null;
  const cutoffDay = legacySettings?.card_cutoff_day ?? 20;
  if (legacySettings) {
    await db
      .insert(appSettings)
      .values({
        id: 1,
        grossSalary: legacySettings.gross_salary,
        netSalary: legacySettings.net_salary,
        payrollDeduction: legacySettings.payroll_deduction,
        gajianStartDay: 25,
        cardCutoffDay: legacySettings.card_cutoff_day,
        statementDay: legacySettings.statement_day,
        cardPaymentDay: legacySettings.card_payment_day,
        cardLimit: legacySettings.card_limit,
        legacySettledBeforeCycle: "2026-10",
      })
      .onConflictDoUpdate({
        target: appSettings.id,
        set: {
          grossSalary: legacySettings.gross_salary,
          netSalary: legacySettings.net_salary,
          payrollDeduction: legacySettings.payroll_deduction,
          cardCutoffDay: legacySettings.card_cutoff_day,
          statementDay: legacySettings.statement_day,
          cardPaymentDay: legacySettings.card_payment_day,
          cardLimit: legacySettings.card_limit,
          legacySettledBeforeCycle: "2026-10",
          updatedAt: new Date(),
        },
      });
    await db
      .update(wallets)
      .set({
        creditLimit: legacySettings.card_limit,
        cutoffDay: legacySettings.card_cutoff_day,
        statementDay: legacySettings.statement_day,
        paymentDay: legacySettings.card_payment_day,
      })
      .where(eq(wallets.id, ccWallet.id));
  }

  // 2. Debt accounts & installments (preserve exact corrected schedules and closed states)
  const legacyAccounts = debtDb
    .query("SELECT * FROM debt_accounts ORDER BY id ASC")
    .all() as LegacyDebtAccount[];
  const legacyInstallments = debtDb
    .query("SELECT * FROM installments ORDER BY id ASC")
    .all() as LegacyInstallment[];

  const accountIdMap = new Map<number, number>();
  let insertedAccounts = 0;
  for (const acc of legacyAccounts) {
    const existing = await db
      .select({ id: debtAccounts.id })
      .from(debtAccounts)
      .where(eq(debtAccounts.key, acc.key))
      .limit(1);
    if (existing[0]) {
      accountIdMap.set(acc.id, existing[0].id);
      continue;
    }
    const inserted = await db
      .insert(debtAccounts)
      .values({
        key: acc.key,
        name: acc.name,
        lender: acc.lender,
        kind: acc.kind,
        walletId: acc.kind === "card_installment" ? ccWallet.id : null,
        initialBalance: acc.initial_balance,
        paymentDay: acc.payment_day,
        paymentMethod: acc.payment_method,
        color: acc.color,
        closedAt: acc.closed_at ? new Date(acc.closed_at) : null,
        createdAt: new Date(acc.created_at),
      })
      .returning({ id: debtAccounts.id });
    if (inserted[0]) {
      accountIdMap.set(acc.id, inserted[0].id);
      insertedAccounts += 1;
    }
  }

  let insertedInstallments = 0;
  for (const inst of legacyInstallments) {
    const targetAccountId = accountIdMap.get(inst.account_id);
    if (!targetAccountId) continue;
    const existing = await db
      .select({ id: installments.id })
      .from(installments)
      .where(
        and(
          eq(installments.accountId, targetAccountId),
          eq(installments.period, inst.period),
          eq(installments.dueDate, inst.due_date),
        ),
      )
      .limit(1);
    if (existing[0]) continue;
    await db.insert(installments).values({
      accountId: targetAccountId,
      period: inst.period,
      dueDate: inst.due_date,
      plannedAmount: inst.planned_amount,
      actualAmount: inst.actual_amount,
      status: inst.status,
      paidAt: inst.paid_at ? new Date(inst.paid_at) : null,
    });
    insertedInstallments += 1;
  }

  // 3. Money Management transactions
  const legacyExpenses = moneyDb
    .query("SELECT * FROM expenses ORDER BY id ASC")
    .all() as LegacyExpense[];

  let insertedMoneyTx = 0;
  for (const row of legacyExpenses) {
    await db
      .insert(categories)
      .values({
        name: row.category.trim(),
        type: row.transaction_type,
        isMandatory: ["hutang", "keluarga"].includes(row.category.trim().toLowerCase()),
      })
      .onConflictDoNothing();

    // Assign deterministic sourceRef for manual rows without one so re-runs never duplicate.
    const sourceRef = row.source_ref?.trim() || `mm-legacy-${row.id}`;
    const existing = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.sourceRef, sourceRef))
      .limit(1);
    if (existing[0]) continue;

    const walletKey = mapFundingSourceToWalletKey(row.funding_source);
    const wallet = walletByKey.get(walletKey) ?? bniWallet;
    const txType =
      row.transaction_type === "income"
        ? "income"
        : row.is_cc_settlement === 1
          ? "settlement"
          : "expense";
    const ccCycleKey =
      wallet.type === "credit_card" ? ccCycleForDate(row.purchase_date, cutoffDay) : null;

    await db.insert(transactions).values({
      type: txType,
      merchant: row.merchant.trim(),
      amount: row.amount_minor,
      transactionDate: row.purchase_date,
      category: row.category.trim(),
      walletId: wallet.id,
      toWalletId: null,
      note: row.note,
      ccCycleKey,
      source: row.source,
      sourceRef,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
    insertedMoneyTx += 1;
  }

  // 4. Debt Management card_transactions (deduped by debt-cc-<id> and CC date+merchant+amount)
  const legacyCardTxs = debtDb
    .query("SELECT * FROM card_transactions ORDER BY id ASC")
    .all() as LegacyCardTx[];

  const existingCcRows = await db
    .select({
      transactionDate: transactions.transactionDate,
      merchant: transactions.merchant,
      amount: transactions.amount,
      sourceRef: transactions.sourceRef,
    })
    .from(transactions)
    .where(eq(transactions.walletId, ccWallet.id));

  const existingRefs = new Set(existingCcRows.map((r) => r.sourceRef).filter(Boolean));
  const existingFingerprints = new Set(
    existingCcRows.map((r) => `${r.transactionDate}|${normalizeMerchant(r.merchant)}|${r.amount}`),
  );

  let insertedCardTx = 0;
  let skippedDupCardTx = 0;
  for (const row of legacyCardTxs) {
    await db
      .insert(categories)
      .values({
        name: row.category.trim(),
        type: "expense",
        isMandatory: false,
      })
      .onConflictDoNothing();

    const ref = `debt-cc-${row.id}`;
    const fp = `${row.transaction_date}|${normalizeMerchant(row.merchant)}|${row.amount}`;
    if (existingRefs.has(ref) || existingFingerprints.has(fp)) {
      skippedDupCardTx += 1;
      continue;
    }

    await db.insert(transactions).values({
      type: "expense",
      merchant: row.merchant.trim(),
      amount: row.amount,
      transactionDate: row.transaction_date,
      category: row.category.trim(),
      walletId: ccWallet.id,
      toWalletId: null,
      note: row.note,
      ccCycleKey: row.cycle_key,
      source: row.note?.includes("tercatat otomatis") ? "system" : "manual",
      sourceRef: ref,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.created_at),
    });
    existingRefs.add(ref);
    existingFingerprints.add(fp);
    insertedCardTx += 1;
  }

  console.log("Legacy migration complete:");
  console.log(`- Debt accounts inserted: ${insertedAccounts} (total mapped: ${accountIdMap.size})`);
  console.log(`- Installments inserted: ${insertedInstallments}`);
  console.log(`- Money Management rows inserted: ${insertedMoneyTx}`);
  console.log(
    `- Debt Management CC rows inserted: ${insertedCardTx} (deduped skipped: ${skippedDupCardTx})`,
  );
  debtDb.close();
  moneyDb.close();
  await client.end();
}

migrate().catch(async (err) => {
  console.error("Migration failed:", err);
  await client.end();
  process.exit(1);
});
