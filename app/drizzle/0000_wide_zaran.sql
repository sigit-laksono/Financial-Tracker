CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"gross_salary" integer DEFAULT 0 NOT NULL,
	"net_salary" integer DEFAULT 0 NOT NULL,
	"payroll_deduction" integer DEFAULT 0 NOT NULL,
	"default_salary_wallet_id" integer,
	"gajian_start_day" integer DEFAULT 25 NOT NULL,
	"card_cutoff_day" integer DEFAULT 20 NOT NULL,
	"statement_day" integer DEFAULT 21 NOT NULL,
	"card_payment_day" integer DEFAULT 25 NOT NULL,
	"card_limit" integer DEFAULT 0 NOT NULL,
	"pin_hash" text,
	"session_version" integer DEFAULT 1 NOT NULL,
	"legacy_settled_before_cycle" varchar(20),
	"last_auto_sync_date" varchar(10),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"valuation_amount" integer NOT NULL,
	"acquisition_cost" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_valuation_non_negative" CHECK ("assets"."valuation_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"action" text NOT NULL,
	"before_json" text,
	"after_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"category_id" integer,
	"period" varchar(20) NOT NULL,
	"limit_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_limit_positive" CHECK ("budgets"."limit_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"bucket" text DEFAULT 'needs' NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"color" text DEFAULT '#00797a' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debt_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"lender" text NOT NULL,
	"kind" text NOT NULL,
	"direction" text DEFAULT 'payable' NOT NULL,
	"wallet_id" integer,
	"initial_balance" integer NOT NULL,
	"payment_day" integer,
	"payment_method" text NOT NULL,
	"color" text NOT NULL,
	"disburse_wallet_id" integer,
	"disbursed_at" timestamp with time zone,
	"interest_rate_bps" integer,
	"source_transaction_id" integer,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debt_accounts_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '🎯' NOT NULL,
	"target_amount" integer NOT NULL,
	"current_amount" integer DEFAULT 0 NOT NULL,
	"target_date" varchar(10),
	"is_emergency_fund" boolean DEFAULT false NOT NULL,
	"wallet_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_target_amount_positive" CHECK ("goals"."target_amount" > 0),
	CONSTRAINT "goals_current_amount_non_negative" CHECK ("goals"."current_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"period" varchar(20) NOT NULL,
	"due_date" varchar(10) NOT NULL,
	"planned_amount" integer NOT NULL,
	"principal_amount" integer,
	"interest_amount" integer DEFAULT 0,
	"actual_amount" integer,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"paid_at" timestamp with time zone,
	"settlement_transaction_id" integer
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant" text NOT NULL,
	"amount" integer NOT NULL,
	"category" text NOT NULL,
	"category_id" integer,
	"wallet_id" integer NOT NULL,
	"due_day" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_paid_period" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_amount_positive" CHECK ("recurring_rules"."amount" > 0),
	CONSTRAINT "recurring_rules_due_day_range" CHECK ("recurring_rules"."due_day" >= 1 AND "recurring_rules"."due_day" <= 31)
);
--> statement-breakpoint
CREATE TABLE "settlement_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_transaction_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"installment_id" integer,
	"cc_wallet_id" integer,
	"cc_cycle_key" text,
	"allocated_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_allocations_amount_positive" CHECK ("settlement_allocations"."allocated_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_splits" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"category" text NOT NULL,
	"category_id" integer,
	"amount" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_splits_amount_positive" CHECK ("transaction_splits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"merchant" text NOT NULL,
	"amount" integer NOT NULL,
	"transaction_date" varchar(10) NOT NULL,
	"category" text NOT NULL,
	"category_id" integer,
	"wallet_id" integer NOT NULL,
	"to_wallet_id" integer,
	"transfer_group_id" text,
	"note" text,
	"cc_cycle_key" text,
	"is_converted_to_installment" boolean DEFAULT false NOT NULL,
	"converted_account_id" integer,
	"installment_id" integer,
	"debt_account_id" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_check" CHECK ("transactions"."type" = 'adjustment' OR "transactions"."amount" > 0),
	CONSTRAINT "transactions_transfer_wallet_check" CHECK ("transactions"."to_wallet_id" IS NULL OR "transactions"."to_wallet_id" != "transactions"."wallet_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_recurring_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"name" text NOT NULL,
	"amount" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_recurring_fees_amount_positive" CHECK ("wallet_recurring_fees"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"account_group" text DEFAULT 'bank' NOT NULL,
	"provider" text DEFAULT 'other' NOT NULL,
	"role" text DEFAULT 'spending' NOT NULL,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"credit_limit" integer,
	"cutoff_day" integer,
	"statement_day" integer,
	"payment_day" integer,
	"color" text NOT NULL,
	"account_number" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_default_salary_wallet_id_wallets_id_fk" FOREIGN KEY ("default_salary_wallet_id") REFERENCES "wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_accounts" ADD CONSTRAINT "debt_accounts_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_accounts" ADD CONSTRAINT "debt_accounts_disburse_wallet_id_wallets_id_fk" FOREIGN KEY ("disburse_wallet_id") REFERENCES "wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_account_id_debt_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "debt_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_settlement_transaction_id_transactions_id_fk" FOREIGN KEY ("settlement_transaction_id") REFERENCES "transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_cc_wallet_id_wallets_id_fk" FOREIGN KEY ("cc_wallet_id") REFERENCES "wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_wallet_id_wallets_id_fk" FOREIGN KEY ("to_wallet_id") REFERENCES "wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_debt_account_id_debt_accounts_id_fk" FOREIGN KEY ("debt_account_id") REFERENCES "debt_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_recurring_fees" ADD CONSTRAINT "wallet_recurring_fees_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_category_idx" ON "assets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_period_idx" ON "budgets" USING btree ("category","period");--> statement-breakpoint
CREATE INDEX "budgets_category_id_idx" ON "budgets" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_type_idx" ON "categories" USING btree ("name","type");--> statement-breakpoint
CREATE INDEX "goals_wallet_idx" ON "goals" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "installments_account_idx" ON "installments" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "installments_period_idx" ON "installments" USING btree ("period");--> statement-breakpoint
CREATE INDEX "installments_due_date_idx" ON "installments" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "installments_settlement_tx_idx" ON "installments" USING btree ("settlement_transaction_id");--> statement-breakpoint
CREATE INDEX "recurring_rules_wallet_idx" ON "recurring_rules" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "recurring_rules_due_day_idx" ON "recurring_rules" USING btree ("due_day");--> statement-breakpoint
CREATE INDEX "settlement_allocations_tx_idx" ON "settlement_allocations" USING btree ("settlement_transaction_id");--> statement-breakpoint
CREATE INDEX "settlement_allocations_inst_idx" ON "settlement_allocations" USING btree ("installment_id");--> statement-breakpoint
CREATE INDEX "settlement_allocations_cc_idx" ON "settlement_allocations" USING btree ("cc_wallet_id","cc_cycle_key");--> statement-breakpoint
CREATE INDEX "transaction_splits_tx_idx" ON "transaction_splits" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_splits_cat_idx" ON "transaction_splits" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_type_idx" ON "transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "transactions_wallet_idx" ON "transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "transactions_cc_cycle_idx" ON "transactions" USING btree ("cc_cycle_key");--> statement-breakpoint
CREATE INDEX "transactions_wallet_date_idx" ON "transactions" USING btree ("wallet_id","transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_type_date_idx" ON "transactions" USING btree ("type","transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_to_wallet_idx" ON "transactions" USING btree ("to_wallet_id");--> statement-breakpoint
CREATE INDEX "transactions_converted_account_idx" ON "transactions" USING btree ("converted_account_id");--> statement-breakpoint
CREATE INDEX "transactions_category_id_idx" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_group_idx" ON "transactions" USING btree ("transfer_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_source_ref_idx" ON "transactions" USING btree ("source_ref");--> statement-breakpoint
CREATE INDEX "wallet_recurring_fees_wallet_idx" ON "wallet_recurring_fees" USING btree ("wallet_id");