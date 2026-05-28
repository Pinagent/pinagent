// SPDX-License-Identifier: Apache-2.0
/**
 * Quick-action chip catalog for the anchored composer.
 *
 * Each chip is a starter prompt the user can click to skip cold-start
 * typing. The chip set is element-aware: `quickActionsFor(el)` walks
 * the catalog and returns only the chips whose `matches(el)` predicate
 * agrees. Two chips (Recolor, Resize) match everything so the row is
 * never empty; the rest specialize.
 *
 *   <button>Get started</button>
 *     → Change text · Recolor · Add hover state · Resize · Make it a link
 *   <a href="/x">Read more</a>
 *     → Change text · Recolor · Add hover state · Resize · Change link
 *   <img src="x.png">
 *     → Change image · Add alt text · Recolor · Resize
 *   <input placeholder="Email">
 *     → Change placeholder · Recolor · Add hover state · Resize
 *
 * Catalog order is preserved through the filter, so users see chips in
 * a predictable position regardless of which element they pick.
 */

/** Public shape rendered into the composer iframe. */
export interface QuickAction {
  /** Stable id, used in tests + analytics. */
  id: string;
  label: string;
  /** Inline SVG markup (no enclosing button — that's the chip). */
  icon: string;
  /** Starter prompt dropped into the textarea when the chip is clicked. */
  prompt: string;
}

interface QuickActionDef extends QuickAction {
  matches: (el: Element) => boolean;
}

const ICON_ATTRS =
  'class="qa-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const CATALOG: ReadonlyArray<QuickActionDef> = [
  {
    id: 'change-text',
    label: 'Change text',
    icon: `<svg ${ICON_ATTRS}><path d="M4 20l6-14 6 14"/><path d="M7 13h6"/></svg>`,
    prompt: 'Change the text to: ',
    matches: (el) => hasOwnVisibleText(el) && !isMedia(el),
  },
  {
    id: 'change-image',
    label: 'Change image',
    icon: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>`,
    prompt: 'Change this image to: ',
    matches: (el) => el.tagName === 'IMG',
  },
  {
    id: 'alt-text',
    label: 'Add alt text',
    icon: `<svg ${ICON_ATTRS}><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    prompt: 'Set the alt text to: ',
    matches: (el) => el.tagName === 'IMG',
  },
  {
    id: 'recolor',
    label: 'Recolor',
    icon: `<svg ${ICON_ATTRS}><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.66h1.99c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2Z"/></svg>`,
    prompt: 'Recolor this to ',
    matches: () => true,
  },
  {
    id: 'hover-state',
    label: 'Add hover state',
    icon: `<svg ${ICON_ATTRS}><path d="M12 3l1.9 5.7L19.5 11l-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.7-1.9L12 3z"/><path d="M19 3v3"/><path d="M5 17v3"/><path d="M17.5 4.5h3"/><path d="M3.5 18.5h3"/></svg>`,
    prompt: 'Add a hover state that ',
    matches: isInteractive,
  },
  {
    id: 'resize',
    label: 'Resize',
    icon: `<svg ${ICON_ATTRS}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
    prompt: 'Resize this to ',
    matches: () => true,
  },
  {
    id: 'change-placeholder',
    label: 'Change placeholder',
    icon: `<svg ${ICON_ATTRS}><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    prompt: 'Change the placeholder text to: ',
    matches: (el) =>
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.hasAttribute('placeholder'),
  },
  {
    id: 'change-link',
    label: 'Change link',
    icon: `<svg ${ICON_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    prompt: 'Change the link target to ',
    matches: isLink,
  },
  {
    id: 'make-link',
    label: 'Make it a link',
    icon: `<svg ${ICON_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    prompt: 'Make this a link to ',
    matches: (el) => !isLink(el) && !isMedia(el) && !isFormControl(el),
  },
];

/**
 * Returns the chips applicable to `el` in catalog order. Always
 * returns at least Recolor + Resize (their predicates accept
 * anything), so the chip row is never empty.
 */
export function quickActionsFor(el: Element): QuickAction[] {
  return CATALOG.filter((a) => a.matches(el)).map(strip);
}

function strip(a: QuickActionDef): QuickAction {
  return { id: a.id, label: a.label, icon: a.icon, prompt: a.prompt };
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
