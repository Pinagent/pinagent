// SPDX-License-Identifier: Apache-2.0
/**
 * Plaintext secrets at rest under `.pinagent/secrets.json`. The
 * dock's Connections route reads / writes via the HTTP endpoints
 * in `vite-plugin` / `next-plugin`, which call into this.
 *
 * For local dev: the secrets file lives on the same filesystem as
 * the user's git credentials, `.env` files, and shell history —
 * there's no real threat model improvement from encrypting at
 * rest. The hosted dashboard tier (spec §13 onwards) will need a
 * different storage backend; the API surface here is shaped so
 * that swap is local.
 *
 * Tokens never round-trip back out — readers either consume the
 * raw token inside the agent process (composer, SDK), or get the
 * presentable shape via `presentable()`.
 */
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const SecretsFileSchema = z
  .object({
    github: z
      .object({
        token: z.string().min(1),
        /** Cached from the validate-on-set GitHub `/user` call. */
        login: z.string().min(1),
      })
      .nullable()
      .optional(),
    anthropic: z
      .object({
        key: z.string().min(1),
      })
      .nullable()
      .optional(),
  })
  .default({});

export type SecretsFile = z.infer<typeof SecretsFileSchema>;

export interface PresentableConnections {
  github: { connected: boolean; login: string | null };
  anthropic: { keySet: boolean };
}

export class SecretsStore {
  constructor(private readonly projectRoot: string) {}

  private path(): string {
    return join(this.projectRoot, '.pinagent', 'secrets.json');
  }

  /** Read + parse. Returns `{}` for "no file yet" — that's expected on first run. */
  async read(): Promise<SecretsFile> {
    const path = this.path();
    if (!existsSync(path)) return SecretsFileSchema.parse({});
    try {
      const raw = await readFile(path, 'utf8');
      return SecretsFileSchema.parse(JSON.parse(raw));
    } catch {
      // Malformed file — don't crash the server; treat as empty and
      // let the user re-enter. (Real recovery happens via the dock UI.)
      return SecretsFileSchema.parse({});
    }
  }

  async patch(patch: Partial<SecretsFile>): Promise<SecretsFile> {
    const current = await this.read();
    const next: SecretsFile = { ...current, ...patch };
    const path = this.path();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(next, null, 2), 'utf8');
    // 0600: owner-only read/write. Best-effort; on Windows this is a no-op.
    try {
      await chmod(path, 0o600);
    } catch {}
    return next;
  }

  async setGithub(token: string, login: string): Promise<void> {
    await this.patch({ github: { token, login } });
  }

  async clearGithub(): Promise<void> {
    await this.patch({ github: null });
  }

  async setAnthropic(key: string): Promise<void> {
    await this.patch({ anthropic: { key } });
  }

  async clearAnthropic(): Promise<void> {
    await this.patch({ anthropic: null });
  }

  async getGithubToken(): Promise<string | null> {
    return (await this.read()).github?.token ?? null;
  }

  async getAnthropicKey(): Promise<string | null> {
    return (await this.read()).anthropic?.key ?? null;
  }

  /** Token-free view safe to ship over the wire. */
  async presentable(): Promise<PresentableConnections> {
    const f = await this.read();
    return {
      github: { connected: Boolean(f.github), login: f.github?.login ?? null },
      anthropic: { keySet: Boolean(f.anthropic) },
    };
  }
}
