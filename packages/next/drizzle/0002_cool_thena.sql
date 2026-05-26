ALTER TABLE `conversations` ADD `worktree_state` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
-- Backfill rows that already have a worktree on disk so the UI sees them as
-- actionable (Land/Discard) rather than as inline-mode rows.
UPDATE `conversations`
  SET `worktree_state` = 'active'
  WHERE `worktree_path` IS NOT NULL AND `commit_sha` IS NULL;
--> statement-breakpoint
-- Older rows whose worktrees were already merged externally (commit_sha set)
-- are treated as `landed` so they don't reappear in the lifecycle UI.
UPDATE `conversations`
  SET `worktree_state` = 'landed'
  WHERE `worktree_path` IS NOT NULL AND `commit_sha` IS NOT NULL;