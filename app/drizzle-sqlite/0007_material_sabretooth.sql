PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`gross_salary` integer DEFAULT 0 NOT NULL,
	`net_salary` integer DEFAULT 0 NOT NULL,
	`payroll_deduction` integer DEFAULT 0 NOT NULL,
	`default_salary_wallet_id` integer,
	`gajian_start_day` integer DEFAULT 25 NOT NULL,
	`card_cutoff_day` integer DEFAULT 20 NOT NULL,
	`statement_day` integer DEFAULT 21 NOT NULL,
	`card_payment_day` integer DEFAULT 25 NOT NULL,
	`card_limit` integer DEFAULT 0 NOT NULL,
	`pin_hash` text,
	`session_version` integer DEFAULT 1 NOT NULL,
	`legacy_settled_before_cycle` text,
	`last_auto_sync_date` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`default_salary_wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("id", "gross_salary", "net_salary", "payroll_deduction", "default_salary_wallet_id", "gajian_start_day", "card_cutoff_day", "statement_day", "card_payment_day", "card_limit", "pin_hash", "session_version", "legacy_settled_before_cycle", "last_auto_sync_date", "updated_at") SELECT "id", "gross_salary", "net_salary", "payroll_deduction", "default_salary_wallet_id", "gajian_start_day", "card_cutoff_day", "statement_day", "card_payment_day", "card_limit", "pin_hash", "session_version", "legacy_settled_before_cycle", "last_auto_sync_date", "updated_at" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `categories` ADD `bucket` text DEFAULT 'needs' NOT NULL;