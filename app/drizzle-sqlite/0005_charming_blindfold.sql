CREATE TABLE `wallet_recurring_fees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallet_recurring_fees_amount_positive" CHECK("wallet_recurring_fees"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `wallet_recurring_fees_wallet_idx` ON `wallet_recurring_fees` (`wallet_id`);--> statement-breakpoint
ALTER TABLE `debt_accounts` ADD `direction` text DEFAULT 'payable' NOT NULL;--> statement-breakpoint
ALTER TABLE `debt_accounts` ADD `disburse_wallet_id` integer REFERENCES wallets(id);--> statement-breakpoint
ALTER TABLE `debt_accounts` ADD `disbursed_at` integer;--> statement-breakpoint
ALTER TABLE `debt_accounts` ADD `interest_rate_bps` integer;--> statement-breakpoint
ALTER TABLE `installments` ADD `principal_amount` integer;--> statement-breakpoint
ALTER TABLE `installments` ADD `interest_amount` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `transactions` ADD `debt_account_id` integer REFERENCES debt_accounts(id);--> statement-breakpoint
UPDATE `installments` SET `principal_amount` = `planned_amount` WHERE `principal_amount` IS NULL;
