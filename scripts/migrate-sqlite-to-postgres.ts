import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import postgres from "postgres";

const SCRIPT_DIR = import.meta.dir;
const ROOT_DIR = resolve(SCRIPT_DIR, "..");

const sqlitePath =
  process.env.SQLITE_PATH ??
  process.argv[2] ??
  resolve(ROOT_DIR, "app/data/financial-tracker.db");

const postgresUrl =
  process.env.DATABASE_URL ??
  process.argv[3] ??
  "postgres://postgres:postgres@localhost:5432/financial_tracker";

if (!existsSync(sqlitePath)) {
  console.error(`[ERROR] SQLite database file not found at: ${sqlitePath}`);
  process.exit(1);
}

console.log("=== ETL Migration: SQLite to PostgreSQL ===");
console.log(`Source SQLite: ${sqlitePath}`);
console.log(`Target Postgres: ${postgresUrl.replace(/:[^:@]+@/, ":***@")}`);

const sqlite = new Database(sqlitePath, { readonly: true });
const sql = postgres(postgresUrl, { max: 1 });

function toDate(val: number | string | null | undefined): Date | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return new Date(val);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function toBool(val: number | boolean | null | undefined): boolean {
  return Boolean(val);
}

async function runMigration() {
  console.log("\n1. Truncating target PostgreSQL tables...");
  // Disable triggers/foreign keys temporarily or truncate cascade
  await sql`
    TRUNCATE TABLE 
      audit_logs,
      assets,
      goals,
      budgets,
      settlement_allocations,
      transaction_splits,
      transactions,
      wallet_recurring_fees,
      recurring_rules,
      installments,
      debt_accounts,
      wallets,
      categories,
      app_settings
    CASCADE
  `;
  console.log("✓ Target tables truncated successfully.");

  console.log("\n2. Migrating tables sequentially...");

  // 1. categories
  const categoryRows = sqlite.query("SELECT * FROM categories ORDER BY id ASC").all() as any[];
  for (const r of categoryRows) {
    await sql`
      INSERT INTO categories (
        id, name, type, bucket, is_mandatory, color, sort_order, is_archived
      ) VALUES (
        ${r.id}, ${r.name}, ${r.type}, ${r.bucket ?? "needs"}, ${toBool(r.is_mandatory)},
        ${r.color ?? "#00797a"}, ${r.sort_order ?? 0}, ${toBool(r.is_archived)}
      )
    `;
  }
  console.log(`✓ categories: ${categoryRows.length} rows`);

  // 2. wallets
  const walletRows = sqlite.query("SELECT * FROM wallets ORDER BY id ASC").all() as any[];
  for (const r of walletRows) {
    await sql`
      INSERT INTO wallets (
        id, key, name, type, account_group, provider, role,
        opening_balance, credit_limit, cutoff_day, statement_day, payment_day,
        color, account_number, sort_order, is_active, created_at
      ) VALUES (
        ${r.id}, ${r.key}, ${r.name}, ${r.type}, ${r.account_group ?? "bank"}, ${r.provider ?? "other"}, ${r.role ?? "spending"},
        ${r.opening_balance ?? 0}, ${r.credit_limit ?? null}, ${r.cutoff_day ?? null}, ${r.statement_day ?? null}, ${r.payment_day ?? null},
        ${r.color}, ${r.account_number ?? null}, ${r.sort_order ?? 0}, ${toBool(r.is_active)}, ${toDate(r.created_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ wallets: ${walletRows.length} rows`);

  // 3. app_settings
  const appSettingsRows = sqlite.query("SELECT * FROM app_settings").all() as any[];
  if (appSettingsRows.length > 0) {
    for (const r of appSettingsRows) {
      await sql`
        INSERT INTO app_settings (
          id, gross_salary, net_salary, payroll_deduction, default_salary_wallet_id,
          gajian_start_day, card_cutoff_day, statement_day, card_payment_day, card_limit,
          pin_hash, session_version, legacy_settled_before_cycle, last_auto_sync_date, updated_at
        ) VALUES (
          ${r.id}, ${r.gross_salary ?? 0}, ${r.net_salary ?? 0}, ${r.payroll_deduction ?? 0}, ${r.default_salary_wallet_id ?? null},
          ${r.gajian_start_day ?? 25}, ${r.card_cutoff_day ?? 20}, ${r.statement_day ?? 21}, ${r.card_payment_day ?? 25}, ${r.card_limit ?? 0},
          ${r.pin_hash ?? null}, ${r.session_version ?? 1}, ${r.legacy_settled_before_cycle ?? null}, ${r.last_auto_sync_date ?? null}, ${toDate(r.updated_at) ?? new Date()}
        )
      `;
    }
  }
  console.log(`✓ app_settings: ${appSettingsRows.length} rows`);

  // 4. debt_accounts
  const debtAccountRows = sqlite.query("SELECT * FROM debt_accounts ORDER BY id ASC").all() as any[];
  for (const r of debtAccountRows) {
    await sql`
      INSERT INTO debt_accounts (
        id, key, name, lender, kind, direction, wallet_id, initial_balance,
        payment_day, payment_method, color, disburse_wallet_id, disbursed_at,
        interest_rate_bps, source_transaction_id, closed_at, created_at
      ) VALUES (
        ${r.id}, ${r.key}, ${r.name}, ${r.lender}, ${r.kind}, ${r.direction ?? "payable"}, ${r.wallet_id ?? null}, ${r.initial_balance},
        ${r.payment_day ?? null}, ${r.payment_method}, ${r.color}, ${r.disburse_wallet_id ?? null}, ${toDate(r.disbursed_at)},
        ${r.interest_rate_bps ?? null}, ${r.source_transaction_id ?? null}, ${toDate(r.closed_at)}, ${toDate(r.created_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ debt_accounts: ${debtAccountRows.length} rows`);

  // 5. installments
  const installmentRows = sqlite.query("SELECT * FROM installments ORDER BY id ASC").all() as any[];
  for (const r of installmentRows) {
    await sql`
      INSERT INTO installments (
        id, account_id, period, due_date, planned_amount, principal_amount,
        interest_amount, actual_amount, status, paid_at, settlement_transaction_id
      ) VALUES (
        ${r.id}, ${r.account_id}, ${r.period}, ${r.due_date}, ${r.planned_amount}, ${r.principal_amount ?? null},
        ${r.interest_amount ?? 0}, ${r.actual_amount ?? null}, ${r.status ?? "upcoming"}, ${toDate(r.paid_at)}, ${r.settlement_transaction_id ?? null}
      )
    `;
  }
  console.log(`✓ installments: ${installmentRows.length} rows`);

  // 6. recurring_rules
  const recurringRuleRows = sqlite.query("SELECT * FROM recurring_rules ORDER BY id ASC").all() as any[];
  for (const r of recurringRuleRows) {
    await sql`
      INSERT INTO recurring_rules (
        id, merchant, amount, category, category_id, wallet_id,
        due_day, is_active, last_paid_period, created_at
      ) VALUES (
        ${r.id}, ${r.merchant}, ${r.amount}, ${r.category}, ${r.category_id ?? null}, ${r.wallet_id},
        ${r.due_day}, ${toBool(r.is_active)}, ${r.last_paid_period ?? null}, ${toDate(r.created_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ recurring_rules: ${recurringRuleRows.length} rows`);

  // 7. wallet_recurring_fees
  const feeRows = sqlite.query("SELECT * FROM wallet_recurring_fees ORDER BY id ASC").all() as any[];
  for (const r of feeRows) {
    await sql`
      INSERT INTO wallet_recurring_fees (
        id, wallet_id, name, amount, is_active, created_at
      ) VALUES (
        ${r.id}, ${r.wallet_id}, ${r.name}, ${r.amount}, ${toBool(r.is_active)}, ${toDate(r.created_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ wallet_recurring_fees: ${feeRows.length} rows`);

  // 8. transactions
  const txRows = sqlite.query("SELECT * FROM transactions ORDER BY id ASC").all() as any[];
  for (const r of txRows) {
    await sql`
      INSERT INTO transactions (
        id, type, merchant, amount, transaction_date, category, category_id,
        wallet_id, to_wallet_id, transfer_group_id, note, cc_cycle_key,
        is_converted_to_installment, converted_account_id, installment_id,
        debt_account_id, source, source_ref, created_at, updated_at
      ) VALUES (
        ${r.id}, ${r.type}, ${r.merchant}, ${r.amount}, ${r.transaction_date}, ${r.category}, ${r.category_id ?? null},
        ${r.wallet_id}, ${r.to_wallet_id ?? null}, ${r.transfer_group_id ?? null}, ${r.note ?? null}, ${r.cc_cycle_key ?? null},
        ${toBool(r.is_converted_to_installment)}, ${r.converted_account_id ?? null}, ${r.installment_id ?? null},
        ${r.debt_account_id ?? null}, ${r.source ?? "manual"}, ${r.source_ref ?? null},
        ${toDate(r.created_at) ?? new Date()}, ${toDate(r.updated_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ transactions: ${txRows.length} rows`);

  // 9. transaction_splits
  const splitRows = sqlite.query("SELECT * FROM transaction_splits ORDER BY id ASC").all() as any[];
  for (const r of splitRows) {
    await sql`
      INSERT INTO transaction_splits (
        id, transaction_id, category, category_id, amount, note, created_at
      ) VALUES (
        ${r.id}, ${r.transaction_id}, ${r.category}, ${r.category_id ?? null}, ${r.amount},
        ${r.note ?? null}, ${toDate(r.created_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ transaction_splits: ${splitRows.length} rows`);

  // 10. settlement_allocations
  const allocRows = sqlite.query("SELECT * FROM settlement_allocations ORDER BY id ASC").all() as any[];
  for (const r of allocRows) {
    await sql`
      INSERT INTO settlement_allocations (
        id, settlement_transaction_id, target_type, installment_id,
        cc_wallet_id, cc_cycle_key, allocated_amount, created_at
      ) VALUES (
        ${r.id}, ${r.settlement_transaction_id}, ${r.target_type}, ${r.installment_id ?? null},
        ${r.cc_wallet_id ?? null}, ${r.cc_cycle_key ?? null}, ${r.allocated_amount},
        ${toDate(r.created_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ settlement_allocations: ${allocRows.length} rows`);

  // 11. budgets
  const budgetRows = sqlite.query("SELECT * FROM budgets ORDER BY id ASC").all() as any[];
  for (const r of budgetRows) {
    await sql`
      INSERT INTO budgets (
        id, category, category_id, period, limit_amount, created_at, updated_at
      ) VALUES (
        ${r.id}, ${r.category}, ${r.category_id ?? null}, ${r.period}, ${r.limit_amount},
        ${toDate(r.created_at) ?? new Date()}, ${toDate(r.updated_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ budgets: ${budgetRows.length} rows`);

  // 12. goals
  const goalRows = sqlite.query("SELECT * FROM goals ORDER BY id ASC").all() as any[];
  for (const r of goalRows) {
    await sql`
      INSERT INTO goals (
        id, name, emoji, target_amount, current_amount, target_date,
        is_emergency_fund, wallet_id, notes, created_at, updated_at
      ) VALUES (
        ${r.id}, ${r.name}, ${r.emoji ?? "🎯"}, ${r.target_amount}, ${r.current_amount ?? 0}, ${r.target_date ?? null},
        ${toBool(r.is_emergency_fund)}, ${r.wallet_id ?? null}, ${r.notes ?? null},
        ${toDate(r.created_at) ?? new Date()}, ${toDate(r.updated_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ goals: ${goalRows.length} rows`);

  // 13. assets
  const assetRows = sqlite.query("SELECT * FROM assets ORDER BY id ASC").all() as any[];
  for (const r of assetRows) {
    await sql`
      INSERT INTO assets (
        id, name, category, type, valuation_amount, acquisition_cost,
        notes, created_at, updated_at
      ) VALUES (
        ${r.id}, ${r.name}, ${r.category}, ${r.type}, ${r.valuation_amount}, ${r.acquisition_cost ?? null},
        ${r.notes ?? null}, ${toDate(r.created_at) ?? new Date()}, ${toDate(r.updated_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ assets: ${assetRows.length} rows`);

  // 14. audit_logs
  const auditRows = sqlite.query("SELECT * FROM audit_logs ORDER BY id ASC").all() as any[];
  for (const r of auditRows) {
    await sql`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action, before_json, after_json, created_at
      ) VALUES (
        ${r.id}, ${r.entity_type}, ${r.entity_id ?? null}, ${r.action},
        ${r.before_json ?? null}, ${r.after_json ?? null}, ${toDate(r.created_at) ?? new Date()}
      )
    `;
  }
  console.log(`✓ audit_logs: ${auditRows.length} rows`);

  console.log("\n3. Synchronizing PostgreSQL sequences...");
  const autoIncTables = [
    "categories",
    "wallets",
    "debt_accounts",
    "installments",
    "recurring_rules",
    "wallet_recurring_fees",
    "transactions",
    "transaction_splits",
    "settlement_allocations",
    "budgets",
    "goals",
    "assets",
    "audit_logs",
  ];

  for (const tableName of autoIncTables) {
    await sql.unsafe(`
      SELECT setval(
        pg_get_serial_sequence('${tableName}', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM ${tableName}), 1), 1),
        (SELECT MAX(id) FROM ${tableName}) IS NOT NULL
      );
    `);
  }
  console.log("✓ All sequence setvals updated.");

  console.log("\n4. Running reconciliation and verification...");
  const tablesToCheck = [
    "app_settings",
    "categories",
    "wallets",
    "debt_accounts",
    "installments",
    "recurring_rules",
    "wallet_recurring_fees",
    "transactions",
    "transaction_splits",
    "settlement_allocations",
    "budgets",
    "goals",
    "assets",
    "audit_logs",
  ];

  let allCountsMatched = true;
  for (const t of tablesToCheck) {
    const sqCount = Number((sqlite.query(`SELECT count(*) as c FROM ${t}`).get() as any)?.c ?? 0);
    const pgRes = await sql.unsafe(`SELECT count(*)::int as c FROM ${t}`);
    const pgCount = Number(pgRes[0]?.c ?? 0);
    if (sqCount !== pgCount) {
      console.error(`✗ Mismatch in table ${t}: SQLite=${sqCount}, PostgreSQL=${pgCount}`);
      allCountsMatched = false;
    } else {
      console.log(`  - Table ${t.padEnd(24)}: ${pgCount} rows (matched)`);
    }
  }

  if (!allCountsMatched) {
    throw new Error("Row count verification failed.");
  }

  // Check sum of wallet opening_balance
  const sqWalletSum = Number((sqlite.query("SELECT COALESCE(SUM(opening_balance), 0) as s FROM wallets").get() as any)?.s ?? 0);
  const pgWalletSumRes = await sql`SELECT COALESCE(SUM(opening_balance), 0)::bigint as s FROM wallets`;
  const pgWalletSum = Number(pgWalletSumRes[0]?.s ?? 0);

  console.log(`\nReconciliation: Wallets opening_balance SUM`);
  console.log(`  SQLite:     Rp${sqWalletSum.toLocaleString("id-ID")}`);
  console.log(`  PostgreSQL: Rp${pgWalletSum.toLocaleString("id-ID")}`);
  if (sqWalletSum !== pgWalletSum) {
    throw new Error(`Wallet balance mismatch! SQLite: ${sqWalletSum}, PG: ${pgWalletSum}`);
  }

  // Check sum of transaction amount
  const sqTxSum = Number((sqlite.query("SELECT COALESCE(SUM(amount), 0) as s FROM transactions").get() as any)?.s ?? 0);
  const pgTxSumRes = await sql`SELECT COALESCE(SUM(amount), 0)::bigint as s FROM transactions`;
  const pgTxSum = Number(pgTxSumRes[0]?.s ?? 0);

  console.log(`\nReconciliation: Transactions amount SUM`);
  console.log(`  SQLite:     Rp${sqTxSum.toLocaleString("id-ID")}`);
  console.log(`  PostgreSQL: Rp${pgTxSum.toLocaleString("id-ID")}`);
  if (sqTxSum !== pgTxSum) {
    throw new Error(`Transactions amount mismatch! SQLite: ${sqTxSum}, PG: ${pgTxSum}`);
  }

  console.log("\n========================================================");
  console.log("✓ SUCCESS: Migration from SQLite to PostgreSQL completed!");
  console.log("  100% of rows transferred with 0 discrepancy.");
  console.log("========================================================");
}

runMigration()
  .catch((err) => {
    console.error("\n[MIGRATION FAILED]", err);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await sql.end();
  });
