ALTER TABLE `wallets` ADD `account_group` text DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE `wallets` ADD `provider` text DEFAULT 'other' NOT NULL;
