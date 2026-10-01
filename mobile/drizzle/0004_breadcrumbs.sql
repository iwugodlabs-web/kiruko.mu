CREATE TABLE `breadcrumbs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`recorded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `breadcrumbs_recorded_at_idx` ON `breadcrumbs` (`recorded_at`);
