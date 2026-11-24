CREATE TABLE `recurring_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant` text NOT NULL,
	`amount` integer NOT NULL,
	`category` text NOT NULL,
	`category_id` integer,
	`wallet_id` integer NOT NULL,
	`due_day` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_paid_period` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_rules_amount_positive" CHECK("recurring_rules"."amount" > 0),
	CONSTRAINT "recurring_rules_due_day_range" CHECK("recurring_rules"."due_day" >= 1 AND "recurring_rules"."due_day" <= 31)
);
--> statement-breakpoint
CREATE INDEX `recurring_rules_wallet_idx` ON `recurring_rules` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `recurring_rules_due_day_idx` ON `recurring_rules` (`due_day`);--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`category` text NOT NULL,
	`category_id` integer,
	`amount` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transaction_splits_amount_positive" CHECK("transaction_splits"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `transaction_splits_tx_idx` ON `transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_splits_cat_idx` ON `transaction_splits` (`category_id`);