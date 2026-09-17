CREATE TABLE `punch_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`timelog_id` integer,
	`depends_on_key` text,
	`payload_json` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`dead_lettered` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `punch_queue_created_at_idx` ON `punch_queue` (`created_at`);
