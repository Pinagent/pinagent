CREATE TABLE `active_runs` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`current_turn` integer NOT NULL,
	`awaiting_ask_id` text,
	`last_error` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`comment` text NOT NULL,
	`agent_session_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`commit_sha` text,
	`branch` text,
	`worktree_path` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`turn` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `widget_anchors` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`file` text,
	`line` integer,
	`col` integer,
	`selector` text NOT NULL,
	`click_x` integer,
	`click_y` integer,
	`viewport_w` integer,
	`viewport_h` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
