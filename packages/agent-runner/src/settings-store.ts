// SPDX-License-Identifier: Apache-2.0
/**
 * Per-project configuration: base branch, worktree retention,
 * cost caps, permission mode. Stored separately from `secrets.json`
 * so the file can be inspected / hand-edited without exposing
 * tokens.
 *
 * Defaults match the fixtures the dock has been showing — the
 * first GET against a fresh project returns those without writing
 * anything to disk. The settings file only materializes once the
 * user actually saves a change.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type PermissionMode,
  PermissionModeSchema,
  PROJECT_PERMISSION_MODES,
} from '@pinagent/shared';
import { z } from 'zod';
import { atomicWriteFile, withFileLock } from './atomic-file';

// Re-export so existing consumers of `@pinagent/agent-runner` keep
// resolving `PermissionMode` / `PermissionModeSchema` against the same
// type that the dock wire-parses. The canonical definition lives in
// `@pinagent/shared/dock-api`, co-located with the label table that
// drives both the Settings picker and the detail-header chip.
export { type PermissionMode, PermissionModeSchema, PROJECT_PERMISSION_MODES };

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

export const ProjectSettingsSchema = z.object({
  baseBranch: z.string().min(1).max(128).regex(BRANCH_RE, 'invalid branch name'),
  worktreeRetentionDays: z.number().int().min(1).max(60),
  perConversationCapUsd: z.number().min(0.1).max(1000),
  monthlyBudgetUsd: z.number().min(0).max(100_000).nullable(),
  permissionMode: PermissionModeSchema,
  // Branch-routing policy (the dev-side mirror of the cloud's
  // `allowedBranchPatterns`). `*`-glob patterns of branches a worktree may
  // land on; empty = any branch allowed. Enforced in `worktree.ts`.
  allowedBranchPatterns: z.array(z.string().min(1).max(128)).max(50),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ProjectSettingsPatchSchema = ProjectSettingsSchema.partial();
export type ProjectSettingsPatch = z.infer<typeof ProjectSettingsPatchSchema>;

export const DEFAULT_SETTINGS: ProjectSettings = {
  baseBranch: 'main',
  worktreeRetentionDays: 7,
  perConversationCapUsd: 5,
  monthlyBudgetUsd: null,
  permissionMode: 'auto',
  allowedBranchPatterns: [],
};

export class SettingsStore {
  constructor(private readonly projectRoot: string) {}

  private path(): string {
    return join(this.projectRoot, '.pinagent', 'config.json');
  }

  async read(): Promise<ProjectSettings> {
    const path = this.path();
    if (!existsSync(path)) return DEFAULT_SETTINGS;
    try {
      const raw = await readFile(path, 'utf8');
      // Apply defaults as a safety net for older config files missing
      // newer fields; the schema then re-validates the merged shape.
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      return ProjectSettingsSchema.parse(merged);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async patch(patch: ProjectSettingsPatch): Promise<ProjectSettings> {
    const path = this.path();
    // Serialize the read-modify-write (so concurrent PATCHes don't clobber) and
    // write atomically (so a crash mid-write doesn't truncate config.json into
    // a parse error that silently resets every setting to its default).
    return withFileLock(path, async () => {
      const current = await this.read();
      const next = ProjectSettingsSchema.parse({ ...current, ...patch });
      await atomicWriteFile(path, JSON.stringify(next, null, 2));
      return next;
    });
  }
}
