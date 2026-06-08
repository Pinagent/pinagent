// SPDX-License-Identifier: Apache-2.0
/**
 * `@`-mention file picker for a composer textarea — the browser analogue
 * of Claude Code's own `@`. Type `@`, get a fuzzy-matched list of project
 * files; type `@/abs/path` or `@~/path` to browse the real filesystem
 * (the "reach anywhere" mode). Picking a file inserts its path into the
 * prompt; picking a directory keeps the menu open so you can drill in.
 *
 * Framework-free so it can attach to the widget's iframe textareas (the
 * pre-submit box and the follow-up box). Backed by `GET /__pinagent/files`
 * (see agent-runner/src/files.ts).
 *
 * Keyboard handling is registered as a CAPTURING listener on the owning
 * document so it runs before the composer's own keydown (Enter→submit,
 * Esc→cancel) and can swallow those keys while the menu is open — the same
 * host/iframe ordering trap that bit the add-element picker, sidestepped by
 * not relying on per-target listener order.
 */

/** One pickable row — mirrors agent-runner's `FileEntry`. */
interface FileEntry {
  path: string;
  name: string;
  dir: string;
  isDir: boolean;
}

interface FilesResponse {
  mode: 'project' | 'path';
  entries: FileEntry[];
  truncated: boolean;
}

export interface MentionMenuOptions {
  /** The textarea to augment. */
  textarea: HTMLTextAreaElement;
  /** The document that owns the textarea (the composer iframe's document). */
  doc: Document;
  /**
   * Called after the menu programmatically rewrites the textarea value, so
   * the host can re-run its own input bookkeeping (submit-enabled,
   * auto-grow). The menu does NOT dispatch a synthetic `input` event —
   * that would re-enter token detection mid-accept.
   */
  onValueChange?: () => void;
}

export interface MentionMenuHandle {
  /** Whether the menu is currently showing options. */
  readonly open: boolean;
  /** Tear down listeners + DOM. Call from the composer's close path. */
  destroy(): void;
}

const FILES_ENDPOINT = '/__pinagent/files';
const DEBOUNCE_MS = 120;

/**
 * The text from the most recent `@` up to the caret, when it forms a live
 * mention token. The `@` must sit at the start of the value or right after
 * whitespace. Tokens that look like a filesystem path (`@/…`, `@~…`) may
 * contain spaces (so `Photos Library/…` keeps browsing); project tokens end
 * at the first space.
 */
function activeMention(ta: HTMLTextAreaElement): { start: number; query: string } | null {
  const pos = ta.selectionStart;
  if (pos == null || pos !== ta.selectionEnd) return null;
  const before = ta.value.slice(0, pos);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return null;
  const query = before.slice(at + 1);
  const isPath = query.startsWith('/') || query.startsWith('~');
  if (!isPath && /\s/.test(query)) return null;
  return { start: at, query };
}

export function attachMentionMenu(opts: MentionMenuOptions): MentionMenuHandle {
  const { textarea: ta, doc, onValueChange } = opts;

  const menu = doc.createElement('div');
  menu.className = 'pa-mention';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  doc.body.appendChild(menu);

  let entries: FileEntry[] = [];
  let active = 0;
  let truncated = false;
  let mentionStart = -1;
  let reqSeq = 0;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let isOpen = false;

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    entries = [];
    mentionStart = -1;
  }

  function position(): void {
    // position: fixed inside the iframe doc is relative to the iframe's
    // own viewport, so getBoundingClientRect coordinates map directly.
    // Pop downward from the textarea's bottom edge, the conventional
    // direction for a typeahead menu so the list grows away from the
    // text you're typing.
    const r = ta.getBoundingClientRect();
    const viewportH = doc.documentElement.clientHeight;
    menu.style.left = `${Math.max(6, r.left)}px`;
    menu.style.width = `${Math.min(r.width, doc.documentElement.clientWidth - 12)}px`;
    menu.style.bottom = 'auto';
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.maxHeight = `${Math.max(96, Math.min(220, viewportH - r.bottom - 10))}px`;
  }

  function render(): void {
    if (entries.length === 0) {
      menu.innerHTML = `<div class="pa-mention-empty">No matching files</div>`;
      position();
      menu.hidden = false;
      return;
    }
    const rows = entries
      .map((e, i) => {
        const sel = i === active ? ' is-active' : '';
        const icon = e.isDir ? FOLDER_SVG : FILE_SVG;
        return (
          `<div class="pa-mention-row${sel}" role="option" data-i="${i}" aria-selected="${i === active}">` +
          `<span class="pa-mention-icon">${icon}</span>` +
          `<span class="pa-mention-name">${esc(e.name)}${e.isDir ? '/' : ''}</span>` +
          `<span class="pa-mention-dir">${esc(e.dir)}</span>` +
          `</div>`
        );
      })
      .join('');
    const more = truncated ? `<div class="pa-mention-more">Keep typing to narrow…</div>` : '';
    menu.innerHTML = rows + more;
    position();
    menu.hidden = false;
    // Keep the active row in view.
    const activeEl = menu.querySelector<HTMLElement>('.pa-mention-row.is-active');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }

  async function query(q: string): Promise<void> {
    const seq = ++reqSeq;
    try {
      const res = await fetch(`${FILES_ENDPOINT}?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = (await res.json()) as FilesResponse;
      if (seq !== reqSeq || !isOpen) return; // a newer keystroke won
      entries = data.entries;
      truncated = data.truncated;
      active = 0;
      render();
    } catch {
      // Network/parse failure — silently leave the menu as-is.
    }
  }

  function refresh(): void {
    const m = activeMention(ta);
    if (!m) {
      close();
      return;
    }
    isOpen = true;
    mentionStart = m.start;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void query(m.query), DEBOUNCE_MS);
  }

  function accept(entry: FileEntry): void {
    const caret = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, mentionStart);
    const after = ta.value.slice(caret);
    // Directories keep the menu open for drill-in (trailing slash, no
    // space); files terminate the mention with a trailing space.
    const insert = entry.isDir ? `@${entry.path}/` : `@${entry.path} `;
    ta.value = before + insert + after;
    const newCaret = before.length + insert.length;
    ta.setSelectionRange(newCaret, newCaret);
    onValueChange?.();
    ta.focus();
    if (entry.isDir) {
      refresh(); // re-query the just-entered directory
    } else {
      close();
    }
  }

  function onInput(): void {
    refresh();
  }

  function onKeydown(e: KeyboardEvent): void {
    // Both the composer and follow-up textareas register this on the same
    // document; only act for keystrokes in our own textarea.
    if (!isOpen || e.target !== ta) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        if (entries.length > 0) {
          active = (active + 1) % entries.length;
          render();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (entries.length > 0) {
          active = (active - 1 + entries.length) % entries.length;
          render();
        }
        break;
      case 'Enter':
      case 'Tab': {
        const chosen = entries[active];
        if (chosen) {
          e.preventDefault();
          e.stopPropagation();
          accept(chosen);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      default:
        break;
    }
  }

  function onClick(e: MouseEvent): void {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.pa-mention-row');
    if (!row) return;
    e.preventDefault();
    const i = Number(row.dataset.i);
    if (Number.isInteger(i) && entries[i]) accept(entries[i]);
  }

  function onPointerMove(e: MouseEvent): void {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.pa-mention-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (Number.isInteger(i) && i !== active) {
      active = i;
      render();
    }
  }

  ta.addEventListener('input', onInput);
  // Caret moves (arrow keys, clicks) can change whether a mention is active.
  ta.addEventListener('keyup', (e) => {
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') refresh();
  });
  ta.addEventListener('blur', () => setTimeout(close, 120));
  // Capture phase on the document → runs before the composer's own keydown.
  doc.addEventListener('keydown', onKeydown, true);
  menu.addEventListener('mousedown', onClick);
  menu.addEventListener('mousemove', onPointerMove);

  return {
    get open() {
      return isOpen;
    },
    destroy() {
      if (debounce) clearTimeout(debounce);
      ta.removeEventListener('input', onInput);
      doc.removeEventListener('keydown', onKeydown, true);
      menu.remove();
    },
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const FOLDER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const FILE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
