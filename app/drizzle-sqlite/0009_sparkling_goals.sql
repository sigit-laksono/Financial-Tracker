CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`emoji` text DEFAULT '🎯' NOT NULL,
	`target_amount` integer NOT NULL,
	`current_amount` integer DEFAULT 0 NOT NULL,
	`target_date` text,
	`is_emergency_fund` integer DEFAULT false NOT NULL,
	`wallet_id` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "goals_target_amount_positive" CHECK("goals"."target_amount" > 0),
	CONSTRAINT "goals_current_amount_non_negative" CHECK("goals"."current_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `goals_wallet_idx` ON `goals` (`wallet_id`);
