// SPDX-License-Identifier: Apache-2.0
/**
 * Quick-action chip catalog for the anchored composer.
 *
 * Each chip is a starter prompt the user can click to skip cold-start
 * typing. The chip set is element-aware in two dimensions:
 *
 *   1. `matches(el)` decides whether the chip applies — `<img>` doesn't
 *      get "Change text", `<a href>` swaps "Make it a link" for
 *      "Change link", etc.
 *   2. `label(el)` and `prompt(el)` are evaluated with the picked
 *      element, so the chip's text can quote the element's current
 *      state: "Change text from "Get started" to: " instead of
 *      "Change the text to: ". The user types only the *new* value.
 *
 * Recolor + Resize match everything and don't use element context, so
 * the chip row is never empty even on weird tags.
 *
 *   <button>Get started</button>
 *     Change text · Recolor · Add hover state · Resize · Make it a link
 *     "Change text" → `Change the text from "Get started" to: `
 *
 *   <a href="/docs">Read more</a>
 *     Change text · Recolor · Add hover state · Resize · Change link
 *     "Change link" → `Change the link target from "/docs" to `
 *
 *   <img src="logo.png" alt="Logo">
 *     Change image · Edit alt text · Recolor · Resize
 *     "Edit alt text" → `Change the alt text from "Logo" to: `
 *
 *   <input placeholder="Email">
 *     Change placeholder · ... → `Change the placeholder from "Email" to: `
 *
 * Catalog order is preserved through the filter, so chips appear in a
 * predictable position regardless of element type.
 */

/** Public shape rendered into the composer iframe. Label and prompt
 *  are resolved (with the element) before this leaves the module. */
export interface QuickAction {
  /** Stable id, used in tests + analytics. */
  id: string;
  label: string;
  /** Inline SVG markup (no enclosing button — that's the chip). */
  icon: string;
  /** Starter prompt dropped into the textarea when the chip is clicked. */
  prompt: string;
}

interface QuickActionDef {
  id: string;
  label: (el: Element) => string;
  icon: string;
  prompt: (el: Element) => string;
  matches: (el: Element) => boolean;
}

const ICON_ATTRS =
  'class="qa-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const CATALOG: ReadonlyArray<QuickActionDef> = [
  {
    id: 'change-text',
    label: () => 'Change text',
    icon: `<svg ${ICON_ATTRS}><path d="M4 20l6-14 6 14"/><path d="M7 13h6"/></svg>`,
    prompt: (el) => {
      const text = ownText(el);
      return text ? `Change the text from "${text}" to: ` : 'Change the text to: ';
    },
    matches: (el) => hasOwnVisibleText(el) && !isMedia(el),
  },
  {
    id: 'change-image',
    label: () => 'Change image',
    icon: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>`,
    prompt: (el) => {
      const src = el.getAttribute('src');
      return src ? `Change this image (currently ${filename(src)}) to: ` : 'Change this image to: ';
    },
    matches: (el) => el.tagName === 'IMG',
  },
  {
    // Same chip handles "Add" (no alt) and "Edit" (has alt) — label
    // flips so the user reads what they're actually about to do.
    id: 'alt-text',
    label: (el) => (el.getAttribute('alt') ? 'Edit alt text' : 'Add alt text'),
    icon: `<svg ${ICON_ATTRS}><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    prompt: (el) => {
      const alt = el.getAttribute('alt');
      return alt ? `Change the alt text from "${alt}" to: ` : 'Set the alt text to: ';
    },
    matches: (el) => el.tagName === 'IMG',
  },
  {
    id: 'recolor',
    label: () => 'Recolor',
    icon: `<svg ${ICON_ATTRS}><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.66h1.99c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2Z"/></svg>`,
    prompt: () => 'Recolor this to ',
    matches: () => true,
  },
  {
    id: 'hover-state',
    label: () => 'Add hover state',
    icon: `<svg ${ICON_ATTRS}><path d="M12 3l1.9 5.7L19.5 11l-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.7-1.9L12 3z"/><path d="M19 3v3"/><path d="M5 17v3"/><path d="M17.5 4.5h3"/><path d="M3.5 18.5h3"/></svg>`,
    prompt: () => 'Add a hover state that ',
    matches: isInteractive,
  },
  {
    id: 'resize',
    label: () => 'Resize',
    icon: `<svg ${ICON_ATTRS}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
    prompt: () => 'Resize this to ',
    matches: () => true,
  },
  {
    id: 'change-placeholder',
    label: () => 'Change placeholder',
    icon: `<svg ${ICON_ATTRS}><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    prompt: (el) => {
      const ph = el.getAttribute('placeholder');
      return ph ? `Change the placeholder from "${ph}" to: ` : 'Change the placeholder text to: ';
    },
    matches: (el) =>
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.hasAttribute('placeholder'),
  },
  {
    id: 'change-link',
    label: () => 'Change link',
    icon: `<svg ${ICON_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    prompt: (el) => {
      // Predicate (isLink) guarantees href is present, but guard anyway.
      const href = el.getAttribute('href');
      return href ? `Change the link target from "${href}" to ` : 'Change the link target to ';
    },
    matches: isLink,
  },
  {
    id: 'make-link',
    label: () => 'Make it a link',
    icon: `<svg ${ICON_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    prompt: () => 'Make this a link to ',
    matches: (el) => !isLink(el) && !isMedia(el) && !isFormControl(el),
  },
];

/**
 * Returns the chips applicable to `el` in catalog order, with label
 * and prompt resolved against the element. Always returns at least
 * Recolor + Resize so the chip row is never empty.
 */
export function quickActionsFor(el: Element): QuickAction[] {
  return CATALOG.filter((a) => a.matches(el)).map((a) => ({
    id: a.id,
    label: a.label(el),
    icon: a.icon,
    prompt: a.prompt(el),
  }));
}

// --- predicates --------------------------------------------------------

/**
 * True when `el` has visible text in its OWN text node children (not
 * just text deep in descendants). Mirrors how a user thinks about
 * "the text on this element": clicking `<div><button>Go</button></div>`
 * should offer "Change text" for the button, not for the wrapping
 * div whose own text content is empty.
 */
function hasOwnVisibleText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? '').trim().length > 0) return true;
  }
  return false;
}

function isInteractive(el: Element): boolean {
  if (
    el.tagName === 'A' ||
    el.tagName === 'BUTTON' ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  ) {
    return true;
  }
  const role = el.getAttribute('role');
  return role === 'button' || role === 'link';
}

function isLink(el: Element): boolean {
  return el.tagName === 'A' && el.hasAttribute('href');
}

function isMedia(el: Element): boolean {
  return (
    el.tagName === 'IMG' ||
    el.tagName === 'SVG' ||
    el.tagName === 'VIDEO' ||
    el.tagName === 'AUDIO' ||
    el.tagName === 'CANVAS' ||
    el.tagName === 'PICTURE'
  );
}

function isFormControl(el: Element): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

// --- context helpers ---------------------------------------------------

/** Collapsed + truncated own text content, or null if blank. */
function ownText(el: Element): string | null {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? '';
  }
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? snippet(clean) : null;
}

/** Last path segment of a URL, with query/hash stripped. Keeps the
 *  prompt readable for `src="https://cdn.../images/long-name.png?v=2"`. */
function filename(src: string): string {
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return snippet(src, 32);
  }
  const path = src.split('?')[0]?.split('#')[0] ?? src;
  const parts = path.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  return last ? snippet(last, 40) : snippet(src, 40);
}

function snippet(s: string, max = 60): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}
