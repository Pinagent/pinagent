// SPDX-License-Identifier: Apache-2.0
/**
 * Lightweight unified-diff renderer. Parses `git diff` output (no
 * `--color`) and renders per-file groups with hunk headers and
 * additions / deletions / context lines.
 *
 * Why custom and not `react-diff-view` / `diff2html`: the dock's bundle
 * budget is 200 KB gz and we already use ~130. A unified diff is small
 * enough to parse inline; we'd otherwise spend ~30 KB+gz pulling in a
 * library for what is essentially "render colored monospace text with
 * file dividers."
 */
import { cn } from '@pinagent/ui/lib/utils';
import { File as FileIcon, FileWarning } from 'lucide-react';

interface ParsedFile {
  /** Most-informative path: prefers `b/`, falls back to `a/`. */
  path: string;
  /** Diff lines for this file (excluding the file-level headers). */
  hunks: HunkLine[];
  /** Binary-file marker — render a stub instead of hunks when set. */
  binary?: boolean;
}

type HunkLine =
  | { kind: 'header'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string }
  | { kind: 'ctx'; text: string }
  | { kind: 'meta'; text: string };

function parseUnifiedDiff(input: string): ParsedFile[] {
  const lines = input.split('\n');
  const files: ParsedFile[] = [];
  let current: ParsedFile | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // New file boundary. Pull both sides from `diff --git a/foo b/foo`;
      // path resolution gets refined by the +++ line below.
      const m = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
      current = { path: m?.[2] ?? line, hunks: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    // File-header lines that don't add value to the rendered diff.
    if (
      line.startsWith('index ') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('--- ')
    ) {
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim();
      if (path !== '/dev/null') {
        current.path = path.replace(/^b\//, '');
      }
      continue;
    }
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      current.binary = true;
      continue;
    }
    if (line.startsWith('@@')) {
      current.hunks.push({ kind: 'header', text: line });
      continue;
    }
    if (line.startsWith('+')) {
      current.hunks.push({ kind: 'add', text: line.slice(1) });
      continue;
    }
    if (line.startsWith('-')) {
      current.hunks.push({ kind: 'del', text: line.slice(1) });
      continue;
    }
    if (line.startsWith('\\')) {
      current.hunks.push({ kind: 'meta', text: line.slice(2) });
      continue;
    }
    if (line.startsWith(' ')) {
      current.hunks.push({ kind: 'ctx', text: line.slice(1) });
    }
    // Trailing blank lines from the split land here; harmless to skip.
  }
  return files;
}

export interface DiffViewProps {
  diff: string;
  truncated?: boolean;
  className?: string;
}

export function DiffView({ diff, truncated, className }: DiffViewProps) {
  const files = parseUnifiedDiff(diff);
  if (files.length === 0) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-border bg-secondary/30',
          'px-3 py-4 text-center text-[11.5px] text-muted-foreground',
          className,
        )}
      >
        No changes to display.
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {files.map((file) => (
        <FileBlock key={file.path} file={file} />
      ))}
      {truncated && (
        <p className="px-1 text-[11px] text-muted-foreground italic">
          Diff truncated at 512 KB. Open the worktree branch for the full diff.
        </p>
      )}
    </div>
  );
}

function FileBlock({ file }: { file: ParsedFile }) {
  return (
    <section className="rounded-md border border-border bg-card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border bg-secondary/40 px-2.5 py-1.5">
        {file.binary ? (
          <FileWarning className="h-3 w-3 text-muted-foreground" aria-hidden />
        ) : (
          <FileIcon className="h-3 w-3 text-muted-foreground" aria-hidden />
        )}
        <span className="font-mono text-[11px] text-foreground truncate">{file.path}</span>
      </header>
      {file.binary ? (
        <p className="px-3 py-2 text-[11px] text-muted-foreground italic">
          Binary file — no inline diff.
        </p>
      ) : (
        <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
          {file.hunks.map((line, i) => (
            // Diff lines repeat (same `+ foo` can appear in two hunks);
            // index is a stable enough key here since order never changes.
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are stable by position
            <DiffLine key={i} line={line} />
          ))}
        </pre>
      )}
    </section>
  );
}

function DiffLine({ line }: { line: HunkLine }) {
  if (line.kind === 'header') {
    return (
      <div className="bg-secondary/60 px-2.5 py-0.5 text-[10.5px] text-muted-foreground">
        {line.text}
      </div>
    );
  }
  const tone =
    line.kind === 'add'
      ? 'bg-status-ready-bg text-status-ready-fg'
      : line.kind === 'del'
        ? 'bg-status-error-bg text-status-error-fg'
        : line.kind === 'meta'
          ? 'text-muted-foreground italic'
          : 'text-foreground/85';
  const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
  return (
    <div className={cn('flex gap-2 px-2.5', tone)}>
      <span aria-hidden className="w-3 shrink-0 select-none text-center">
        {prefix}
      </span>
      <span className="flex-1 whitespace-pre">{line.text || ' '}</span>
    </div>
  );
}
