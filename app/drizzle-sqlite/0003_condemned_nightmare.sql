CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `__new_budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`category_id` integer,
	`period` text NOT NULL,
	`limit_amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "budgets_limit_positive" CHECK("__new_budgets"."limit_amount" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_budgets`("id", "category", "category_id", "period", "limit_amount", "created_at", "updated_at")
SELECT b."id", b."category",
	(SELECT c."id" FROM `categories` c WHERE c."type" = 'expense' AND LOWER(TRIM(c."name")) = LOWER(TRIM(b."category")) LIMIT 1),
	b."period", b."limit_amount", b."created_at", b."updated_at"
FROM `budgets` b;--> statement-breakpoint
DROP TABLE `budgets`;--> statement-breakpoint
ALTER TABLE `__new_budgets` RENAME TO `budgets`;--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_category_period_idx` ON `budgets` (`category`,`period`);--> statement-breakpoint
CREATE INDEX `budgets_category_id_idx` ON `budgets` (`category_id`);--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`merchant` text NOT NULL,
	`amount` integer NOT NULL,
	`transaction_date` text NOT NULL,
	`category` text NOT NULL,
	`category_id` integer,
	`wallet_id` integer NOT NULL,
	`to_wallet_id` integer,
	`transfer_group_id` text,
	`note` text,
	`cc_cycle_key` text,
	`is_converted_to_installment` integer DEFAULT false NOT NULL,
	`converted_account_id` integer,
	`installment_id` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_amount_check" CHECK("__new_transactions"."type" = 'adjustment' OR "__new_transactions"."amount" > 0),
	CONSTRAINT "transactions_transfer_wallet_check" CHECK("__new_transactions"."to_wallet_id" IS NULL OR "__new_transactions"."to_wallet_id" != "__new_transactions"."wallet_id")
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "type", "merchant", "amount", "transaction_date", "category", "category_id", "wallet_id", "to_wallet_id", "transfer_group_id", "note", "cc_cycle_key", "is_converted_to_installment", "converted_account_id", "installment_id", "source", "source_ref", "created_at", "updated_at")
SELECT t."id", t."type", t."merchant", t."amount", t."transaction_date", t."category",
	CASE
		WHEN t."type" = 'income' THEN (SELECT c."id" FROM `categories` c WHERE c."type" = 'income' AND LOWER(TRIM(c."name")) = LOWER(TRIM(t."category")) LIMIT 1)
		WHEN t."type" IN ('expense', 'settlement') THEN (SELECT c."id" FROM `categories` c WHERE c."type" = 'expense' AND LOWER(TRIM(c."name")) = LOWER(TRIM(t."category")) LIMIT 1)
		ELSE NULL
	END,
	t."wallet_id", t."to_wallet_id", NULL, t."note", t."cc_cycle_key", t."is_converted_to_installment", t."converted_account_id", t."installment_id", t."source", t."source_ref", t."created_at", t."updated_at"
FROM `transactions` t;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_type_idx` ON `transactions` (`type`);--> statement-breakpoint
CREATE INDEX `transactions_wallet_idx` ON `transactions` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `transactions_cc_cycle_idx` ON `transactions` (`cc_cycle_key`);--> statement-breakpoint
CREATE INDEX `transactions_wallet_date_idx` ON `transactions` (`wallet_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_type_date_idx` ON `transactions` (`type`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_to_wallet_idx` ON `transactions` (`to_wallet_id`);--> statement-breakpoint
CREATE INDEX `transactions_converted_account_idx` ON `transactions` (`converted_account_id`);--> statement-breakpoint
CREATE INDEX `transactions_category_id_idx` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_transfer_group_idx` ON `transactions` (`transfer_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_source_ref_idx` ON `transactions` (`source_ref`);--> statement-breakpoint
CREATE TABLE `settlement_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`settlement_transaction_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`installment_id` integer,
	`cc_wallet_id` integer,
	`cc_cycle_key` text,
	`allocated_amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`settlement_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cc_wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settlement_allocations_amount_positive" CHECK("settlement_allocations"."allocated_amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `settlement_allocations_tx_idx` ON `settlement_allocations` (`settlement_transaction_id`);--> statement-breakpoint
CREATE INDEX `settlement_allocations_inst_idx` ON `settlement_allocations` (`installment_id`);--> statement-breakpoint
CREATE INDEX `settlement_allocations_cc_idx` ON `settlement_allocations` (`cc_wallet_id`,`cc_cycle_key`);--> statement-breakpoint
INSERT INTO `settlement_allocations`("settlement_transaction_id", "target_type", "installment_id", "cc_wallet_id", "cc_cycle_key", "allocated_amount", "created_at")
SELECT i."settlement_transaction_id", 'installment', i."id", NULL, NULL, COALESCE(i."actual_amount", i."planned_amount"), COALESCE(i."paid_at", t."created_at")
FROM `installments` i
JOIN `transactions` t ON t."id" = i."settlement_transaction_id"
WHERE i."status" = 'paid' AND i."settlement_transaction_id" IS NOT NULL AND COALESCE(i."actual_amount", i."planned_amount") > 0;
--> statement-breakpoint
INSERT INTO `settlement_allocations`("settlement_transaction_id", "target_type", "installment_id", "cc_wallet_id", "cc_cycle_key", "allocated_amount", "created_at")
SELECT t."id", 'cc_cycle', NULL, COALESCE(t."to_wallet_id", (SELECT w."id" FROM `wallets` w WHERE w."type" = 'credit_card' LIMIT 1)), t."cc_cycle_key",
	(t."amount" - COALESCE((SELECT SUM(COALESCE(i."actual_amount", i."planned_amount")) FROM `installments` i WHERE i."settlement_transaction_id" = t."id"), 0)),
	t."created_at"
FROM `transactions` t
WHERE t."type" = 'settlement' AND t."cc_cycle_key" IS NOT NULL
	AND (t."amount" - COALESCE((SELECT SUM(COALESCE(i."actual_amount", i."planned_amount")) FROM `installments` i WHERE i."settlement_transaction_id" = t."id"), 0)) > 0;
--> statement-breakpoint
CREATE INDEX `installments_settlement_tx_idx` ON `installments` (`settlement_transaction_id`);
