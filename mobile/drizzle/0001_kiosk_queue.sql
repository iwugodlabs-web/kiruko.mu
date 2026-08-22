CREATE TABLE `kiosk_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`private_user_id` integer NOT NULL,
	`pin` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`photo_b64` text,
	`idempotency_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`dead_lettered` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kiosk_queue_created_at_idx` ON `kiosk_queue` (`created_at`);
