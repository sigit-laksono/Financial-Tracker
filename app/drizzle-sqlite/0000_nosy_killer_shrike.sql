CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`gross_salary` integer DEFAULT 10481625 NOT NULL,
	`net_salary` integer DEFAULT 8981625 NOT NULL,
	`payroll_deduction` integer DEFAULT 1500000 NOT NULL,
	`gajian_start_day` integer DEFAULT 25 NOT NULL,
	`card_cutoff_day` integer DEFAULT 20 NOT NULL,
	`statement_day` integer DEFAULT 21 NOT NULL,
	`card_payment_day` integer DEFAULT 25 NOT NULL,
	`card_limit` integer DEFAULT 20000000 NOT NULL,
	`pin_hash` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`period` text NOT NULL,
	`limit_amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_category_period_idx` ON `budgets` (`category`,`period`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`is_mandatory` integer DEFAULT false NOT NULL,
	`color` text DEFAULT '#00797a' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_type_idx` ON `categories` (`name`,`type`);--> statement-breakpoint
CREATE TABLE `debt_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`lender` text NOT NULL,
	`kind` text NOT NULL,
	`wallet_id` integer,
	`initial_balance` integer NOT NULL,
	`payment_day` integer,
	`payment_method` text NOT NULL,
	`color` text NOT NULL,
	`source_transaction_id` integer,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debt_accounts_key_unique` ON `debt_accounts` (`key`);--> statement-breakpoint
CREATE TABLE `installments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`period` text NOT NULL,
	`due_date` text NOT NULL,
	`planned_amount` integer NOT NULL,
	`actual_amount` integer,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`paid_at` integer,
	`settlement_transaction_id` integer,
	FOREIGN KEY (`account_id`) REFERENCES `debt_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `installments_account_idx` ON `installments` (`account_id`);--> statement-breakpoint
CREATE INDEX `installments_period_idx` ON `installments` (`period`);--> statement-breakpoint
CREATE INDEX `installments_due_date_idx` ON `installments` (`due_date`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`merchant` text NOT NULL,
	`amount` integer NOT NULL,
	`transaction_date` text NOT NULL,
	`category` text NOT NULL,
	`wallet_id` integer NOT NULL,
	`to_wallet_id` integer,
	`note` text,
	`cc_cycle_key` text,
	`is_converted_to_installment` integer DEFAULT false NOT NULL,
	`converted_account_id` integer,
	`installment_id` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_type_idx` ON `transactions` (`type`);--> statement-breakpoint
CREATE INDEX `transactions_wallet_idx` ON `transactions` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `transactions_cc_cycle_idx` ON `transactions` (`cc_cycle_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_source_ref_idx` ON `transactions` (`source_ref`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`credit_limit` integer,
	`cutoff_day` integer,
	`statement_day` integer,
	`payment_day` integer,
	`color` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_key_unique` ON `wallets` (`key`);