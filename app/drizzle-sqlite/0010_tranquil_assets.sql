CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`type` text NOT NULL,
	`valuation_amount` integer NOT NULL,
	`acquisition_cost` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "assets_valuation_non_negative" CHECK("assets"."valuation_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `assets_category_idx` ON `assets` (`category`);
