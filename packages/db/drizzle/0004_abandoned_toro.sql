CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`payload` text DEFAULT ('{}') NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
