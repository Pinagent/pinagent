ALTER TABLE `conversations` ADD `title` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `archived` integer DEFAULT false NOT NULL;