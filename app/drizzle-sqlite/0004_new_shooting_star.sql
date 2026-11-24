ALTER TABLE `app_settings` ADD `default_salary_wallet_id` integer REFERENCES wallets(id);--> statement-breakpoint
ALTER TABLE `wallets` ADD `role` text DEFAULT 'spending' NOT NULL;--> statement-breakpoint
UPDATE `wallets` SET `role` = 'credit_card' WHERE `type` = 'credit_card';
