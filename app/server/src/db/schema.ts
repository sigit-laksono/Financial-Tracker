import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  type: text("type", { enum: ["bank", "ewallet", "cash", "credit_card"] }).notNull(),
  accountGroup: text("account_group", { enum: ["bank", "ewallet", "cash", "credit", "other"] })
    .notNull()
    .default("bank"),
  provider: text("provider", {
    enum: [
      "bca",
      "mandiri",
      "bni",
      "bri",
      "btn",
      "cimb",
      "bsi",
      "permata",
      "danamon",
      "jago",
      "seabank",
      "blu",
      "jenius",
      "gopay",
      "ovo",
      "dana",
      "shopeepay",
      "linkaja",
      "astrapay",
      "isaku",
      "mega",
      "spaylater",
      "gopaylater",
      "kredivo",
      "akulaku",
      "traveloka_paylater",
      "indodana",
      "atome",
      "cash",
      "other",
    ],
  })
    .notNull()
    .default("other"),
  role: text("role", { enum: ["spending", "savings", "credit_card"] })
    .notNull()
    .default("spending"),
  // All monetary amounts are stored as whole IDR integers (never cents).
  openingBalance: integer("opening_balance").notNull().default(0),
  creditLimit: integer("credit_limit"),
  cutoffDay: integer("cutoff_day"),
  statementDay: integer("statement_day"),
  paymentDay: integer("payment_day"),
  color: text("color").notNull(),
  accountNumber: text("account_number"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$defaultFn(() => new Date()),
});

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type", { enum: ["expense", "income"] }).notNull(),
    bucket: text("bucket", { enum: ["needs", "wants", "savings"] })
      .notNull()
      .default("needs"),
    isMandatory: boolean("is_mandatory").notNull().default(false),
    color: text("color").notNull().default("#00797a"),
    sortOrder: integer("sort_order").notNull().default(0),
    isArchived: boolean("is_archived").notNull().default(false),
  },
  (table) => [uniqueIndex("categories_name_type_idx").on(table.name, table.type)],
);

export const debtAccounts = pgTable("debt_accounts", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  lender: text("lender").notNull(),
  kind: text("kind", { enum: ["loan", "card_installment", "payroll", "receivable"] }).notNull(),
  direction: text("direction", { enum: ["payable", "receivable"] })
    .notNull()
    .default("payable"),
  walletId: integer("wallet_id").references(() => wallets.id),
  initialBalance: integer("initial_balance").notNull(),
  paymentDay: integer("payment_day"),
  paymentMethod: text("payment_method").notNull(),
  color: text("color").notNull(),
  disburseWalletId: integer("disburse_wallet_id").references(() => wallets.id),
  disbursedAt: timestamp("disbursed_at", { withTimezone: true, mode: "date" }),
  interestRateBps: integer("interest_rate_bps"),
  // Cross-reference stays nullable without FK constraint to prevent circular insert locks.
  sourceTransactionId: integer("source_transaction_id"),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$defaultFn(() => new Date()),
});

export const installments = pgTable(
  "installments",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => debtAccounts.id),
    period: varchar("period", { length: 20 }).notNull(),
    dueDate: varchar("due_date", { length: 10 }).notNull(),
    plannedAmount: integer("planned_amount").notNull(),
    principalAmount: integer("principal_amount"),
    interestAmount: integer("interest_amount").default(0),
    actualAmount: integer("actual_amount"),
    status: text("status", { enum: ["upcoming", "paid"] })
      .notNull()
      .default("upcoming"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    settlementTransactionId: integer("settlement_transaction_id"),
  },
  (table) => [
    index("installments_account_idx").on(table.accountId),
    index("installments_period_idx").on(table.period),
    index("installments_due_date_idx").on(table.dueDate),
    index("installments_settlement_tx_idx").on(table.settlementTransactionId),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    type: text("type", {
      enum: [
        "expense",
        "income",
        "transfer",
        "settlement",
        "adjustment",
        "debt_disbursement",
        "debt_collection",
        "loan_disbursement",
      ],
    }).notNull(),
    merchant: text("merchant").notNull(),
    // Signed only for balance adjustments; all other types store positive IDR amounts.
    amount: integer("amount").notNull(),
    transactionDate: varchar("transaction_date", { length: 10 }).notNull(),
    category: text("category").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    walletId: integer("wallet_id")
      .notNull()
      .references(() => wallets.id),
    toWalletId: integer("to_wallet_id").references(() => wallets.id),
    transferGroupId: text("transfer_group_id"),
    note: text("note"),
    ccCycleKey: text("cc_cycle_key"),
    isConvertedToInstallment: boolean("is_converted_to_installment").notNull().default(false),
    convertedAccountId: integer("converted_account_id"),
    installmentId: integer("installment_id"),
    debtAccountId: integer("debt_account_id").references(() => debtAccounts.id),
    source: text("source", { enum: ["manual", "whatsapp", "import", "system"] })
      .notNull()
      .default("manual"),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("transactions_date_idx").on(table.transactionDate),
    index("transactions_type_idx").on(table.type),
    index("transactions_wallet_idx").on(table.walletId),
    index("transactions_cc_cycle_idx").on(table.ccCycleKey),
    index("transactions_wallet_date_idx").on(table.walletId, table.transactionDate),
    index("transactions_type_date_idx").on(table.type, table.transactionDate),
    index("transactions_to_wallet_idx").on(table.toWalletId),
    index("transactions_converted_account_idx").on(table.convertedAccountId),
    index("transactions_category_id_idx").on(table.categoryId),
    index("transactions_transfer_group_idx").on(table.transferGroupId),
    uniqueIndex("transactions_source_ref_idx").on(table.sourceRef),
    check("transactions_amount_check", sql`${table.type} = 'adjustment' OR ${table.amount} > 0`),
    check(
      "transactions_transfer_wallet_check",
      sql`${table.toWalletId} IS NULL OR ${table.toWalletId} != ${table.walletId}`,
    ),
  ],
);

export const settlementAllocations = pgTable(
  "settlement_allocations",
  {
    id: serial("id").primaryKey(),
    settlementTransactionId: integer("settlement_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: ["installment", "cc_cycle"] }).notNull(),
    installmentId: integer("installment_id").references(() => installments.id, {
      onDelete: "set null",
    }),
    ccWalletId: integer("cc_wallet_id").references(() => wallets.id),
    ccCycleKey: text("cc_cycle_key"),
    allocatedAmount: integer("allocated_amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("settlement_allocations_tx_idx").on(table.settlementTransactionId),
    index("settlement_allocations_inst_idx").on(table.installmentId),
    index("settlement_allocations_cc_idx").on(table.ccWalletId, table.ccCycleKey),
    check("settlement_allocations_amount_positive", sql`${table.allocatedAmount} > 0`),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    // "default" acts as the recurring template unless overridden by a YYYY-MM period row.
    period: varchar("period", { length: 20 }).notNull(),
    limitAmount: integer("limit_amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("budgets_category_period_idx").on(table.category, table.period),
    index("budgets_category_id_idx").on(table.categoryId),
    check("budgets_limit_positive", sql`${table.limitAmount} > 0`),
  ],
);

export const goals = pgTable(
  "goals",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull().default("🎯"),
    targetAmount: integer("target_amount").notNull(),
    currentAmount: integer("current_amount").notNull().default(0),
    targetDate: varchar("target_date", { length: 10 }),
    isEmergencyFund: boolean("is_emergency_fund").notNull().default(false),
    walletId: integer("wallet_id").references(() => wallets.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("goals_wallet_idx").on(table.walletId),
    check("goals_target_amount_positive", sql`${table.targetAmount} > 0`),
    check("goals_current_amount_non_negative", sql`${table.currentAmount} >= 0`),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category", { enum: ["investment", "fixed"] }).notNull(),
    type: text("type").notNull(),
    valuationAmount: integer("valuation_amount").notNull(),
    acquisitionCost: integer("acquisition_cost"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("assets_category_idx").on(table.category),
    check("assets_valuation_non_negative", sql`${table.valuationAmount} >= 0`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    action: text("action").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_created_idx").on(table.createdAt),
  ],
);

export const walletRecurringFees = pgTable(
  "wallet_recurring_fees",
  {
    id: serial("id").primaryKey(),
    walletId: integer("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amount: integer("amount").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("wallet_recurring_fees_wallet_idx").on(table.walletId),
    check("wallet_recurring_fees_amount_positive", sql`${table.amount} > 0`),
  ],
);

export const transactionSplits = pgTable(
  "transaction_splits",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("transaction_splits_tx_idx").on(table.transactionId),
    index("transaction_splits_cat_idx").on(table.categoryId),
    check("transaction_splits_amount_positive", sql`${table.amount} > 0`),
  ],
);

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: serial("id").primaryKey(),
    merchant: text("merchant").notNull(),
    amount: integer("amount").notNull(),
    category: text("category").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    walletId: integer("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    dueDay: integer("due_day").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastPaidPeriod: varchar("last_paid_period", { length: 20 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("recurring_rules_wallet_idx").on(table.walletId),
    index("recurring_rules_due_day_idx").on(table.dueDay),
    check("recurring_rules_amount_positive", sql`${table.amount} > 0`),
    check("recurring_rules_due_day_range", sql`${table.dueDay} >= 1 AND ${table.dueDay} <= 31`),
  ],
);

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  grossSalary: integer("gross_salary").notNull().default(0),
  netSalary: integer("net_salary").notNull().default(0),
  payrollDeduction: integer("payroll_deduction").notNull().default(0),
  defaultSalaryWalletId: integer("default_salary_wallet_id").references(() => wallets.id),
  gajianStartDay: integer("gajian_start_day").notNull().default(25),
  cardCutoffDay: integer("card_cutoff_day").notNull().default(20),
  statementDay: integer("statement_day").notNull().default(21),
  cardPaymentDay: integer("card_payment_day").notNull().default(25),
  cardLimit: integer("card_limit").notNull().default(0),
  pinHash: text("pin_hash"),
  sessionVersion: integer("session_version").notNull().default(1),
  legacySettledBeforeCycle: varchar("legacy_settled_before_cycle", { length: 20 }),
  lastAutoSyncDate: varchar("last_auto_sync_date", { length: 10 }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$defaultFn(() => new Date()),
});
