// SPDX-License-Identifier: Apache-2.0
import { cn } from '@pinagent/ui/lib/utils';
import { File as FileIcon, Folder as FolderIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { FileEntry, FileListResult } from '../transport';

/**
 * `@`-mention file picker for the dock's reply box — the dock analogue of
 * the widget composer's mention menu and Claude Code's own `@`. Type `@`
 * for a fuzzy-matched list of project files; type `@/abs/path` or `@~/path`
 * to browse the real filesystem.
 *
 * Returns merge-in handlers (`onChange`, `onKeyDown`) plus a `popover`
 * node the caller renders just above its textarea. `onKeyDown` returns
 * `true` when it consumed the key (caller must then skip its own
 * Enter-to-send handling).
 */
export interface UseFileMention {
  popover: React.ReactNode;
  /** Call from the textarea's onChange, after updating your own value state. */
  onChange: (el: HTMLTextAreaElement) => void;
  /** Call first from the textarea's onKeyDown; returns true if it handled the key. */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

interface MentionToken {
  start: number;
  query: string;
}

/** The live mention token ending at the caret, if any. Mirrors mention-menu.ts. */
function activeMention(value: string, caret: number): MentionToken | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return null;
  const query = before.slice(at + 1);
  const isPath = query.startsWith('/') || query.startsWith('~');
  if (!isPath && /\s/.test(query)) return null;
  return { start: at, query };
}

const DEBOUNCE_MS = 120;

export function useFileMention(args: {
  listFiles: (query: string) => Promise<FileListResult>;
  setValue: (value: string) => void;
}): UseFileMention {
  const { listFiles, setValue } = args;
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [active, setActive] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const startRef = useRef(-1);
  const elRef = useRef<HTMLTextAreaElement | null>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setEntries([]);
    startRef.current = -1;
  }, []);

  const runQuery = useCallback(
    (q: string) => {
      const seq = ++seqRef.current;
      void listFiles(q)
        .then((res) => {
          if (seq !== seqRef.current) return; // newer keystroke won
          setEntries(res.entries);
          setTruncated(res.truncated);
          setActive(0);
          setOpen(true);
        })
        .catch(() => {
          // Leave the menu as-is on failure.
        });
    },
    [listFiles],
  );

  const refresh = useCallback(
    (el: HTMLTextAreaElement) => {
      elRef.current = el;
      const caret = el.selectionStart ?? el.value.length;
      const token = activeMention(el.value, caret);
      if (!token) {
        close();
        return;
      }
      startRef.current = token.start;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runQuery(token.query), DEBOUNCE_MS);
    },
    [close, runQuery],
  );

  const accept = useCallback(
    (entry: FileEntry) => {
      const el = elRef.current;
      if (!el || startRef.current < 0) return;
      const caret = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, startRef.current);
      const after = el.value.slice(caret);
      // Directories keep browsing (trailing slash); files terminate with a space.
      const insert = entry.isDir ? `@${entry.path}/` : `@${entry.path} `;
      const next = before + insert + after;
      const newCaret = before.length + insert.length;
      setValue(next);
      // Restore the caret + re-detect after React re-renders the value.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(newCaret, newCaret);
        if (entry.isDir) refresh(el);
      });
      if (!entry.isDir) close();
    },
    [setValue, close, refresh],
  );

  const onChange = useCallback((el: HTMLTextAreaElement) => refresh(el), [refresh]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open || entries.length === 0) {
        // Still swallow Escape if the (empty) menu is open.
        if (open && e.key === 'Escape') {
          e.preventDefault();
          close();
          return true;
        }
        return false;
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActive((a) => (a + 1) % entries.length);
          return true;
        case 'ArrowUp':
          e.preventDefault();
          setActive((a) => (a - 1 + entries.length) % entries.length);
          return true;
        case 'Enter':
        case 'Tab': {
          const chosen = entries[active];
          if (chosen) {
            e.preventDefault();
            accept(chosen);
          }
          return true;
        }
        case 'Escape':
          e.preventDefault();
          close();
          return true;
        default:
          return false;
      }
    },
    [open, entries, active, accept, close],
  );

  const popover =
    open && entries.length > 0 ? (
      <div
        className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
        role="listbox"
      >
        {entries.map((entry, i) => (
          <button
            key={entry.path}
            type="button"
            role="option"
            aria-selected={i === active}
            // mousedown (not click) so it fires before the textarea's blur.
            onMouseDown={(e) => {
              e.preventDefault();
              accept(entry);
            }}
            onMouseMove={() => setActive(i)}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs',
              i === active && 'bg-accent',
            )}
          >
            {entry.isDir ? (
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="shrink-0 truncate font-medium">
              {entry.name}
              {entry.isDir ? '/' : ''}
            </span>
            <span className="ml-auto truncate text-right font-mono text-[11px] text-muted-foreground">
              {entry.dir}
            </span>
          </button>
        ))}
        {truncated && (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">Keep typing to narrow…</div>
        )}
      </div>
    ) : null;

  return { popover, onChange, onKeyDown };
}
