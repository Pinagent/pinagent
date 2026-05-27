UPDATE `conversations`
SET `worktree_state` = 'landed'
WHERE `status` = 'fixed' AND `worktree_state` = 'none';
--> statement-breakpoint
UPDATE `conversations`
SET `worktree_state` = 'discarded'
WHERE `status` = 'wontfix' AND `worktree_state` = 'none';
