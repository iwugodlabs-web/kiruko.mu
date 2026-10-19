CREATE TABLE `sales_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`client_uuid` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`dead_lettered` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sales_queue_created_at_idx` ON `sales_queue` (`created_at`);
