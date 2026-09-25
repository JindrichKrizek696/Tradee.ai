CREATE TABLE `watch_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument` text NOT NULL,
	`flag` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `watch_flags_user` ON `watch_flags` (`user_id`);