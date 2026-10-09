// SPDX-License-Identifier: Apache-2.0
/**
 * Markup for the inline `ask_user` / permission-prompt form in the
 * conversation feed, and the resolved row that replaces it. Pure DOM and
 * input wiring — the stream handler owns the pending-ask state and decides
 * when a form is shown, answered or retired.
 */

export interface AskFormSpec {
  question: string;
  options?: string[];
  context?: string;
  /** A tool-permission prompt rather than a free-form question. */
  permission: boolean;
  /** Called with the clicked option or the typed answer. */
  onSubmit: (answer: string) => void;
}

export interface AskForm {
  root: HTMLElement;
  input: HTMLTextAreaElement;
}

function el(idoc: Document, tag: string, className?: string, text?: string): HTMLElement {
  const node = idoc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function buildAskForm(idoc: Document, spec: AskFormSpec): AskForm {
  const wrap = el(idoc, 'div', spec.permission ? 'ask-form permission' : 'ask-form');
  wrap.appendChild(el(idoc, 'div', 'ask-question', spec.question));
  if (spec.context) wrap.appendChild(el(idoc, 'div', 'ask-context', spec.context));

  if (spec.options && spec.options.length > 0) {
    const opts = el(idoc, 'div', 'ask-options');
    for (const o of spec.options) {
      const btn = el(idoc, 'button', 'ask-option') as HTMLButtonElement;
      btn.type = 'button';
      btn.textContent = o;
      btn.addEventListener('click', () => spec.onSubmit(o));
      opts.appendChild(btn);
    }
    wrap.appendChild(opts);
  }

  const row = el(idoc, 'div', 'ask-row');
  const ta = el(idoc, 'textarea', 'ask-input') as HTMLTextAreaElement;
  // A permission prompt's free-text reply is a "no, and here's why".
  ta.placeholder = spec.permission ? 'Or deny with a note…' : 'Type your answer…';
  ta.rows = 2;
  const sendBtn = el(idoc, 'button', 'btn primary') as HTMLButtonElement;
  sendBtn.type = 'button';
  sendBtn.textContent = 'Send';
  sendBtn.disabled = true;
  ta.addEventListener('input', () => {
    sendBtn.disabled = ta.value.trim().length === 0;
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendBtn.click();
    }
  });
  sendBtn.addEventListener('click', () => {
    const answer = ta.value.trim();
    if (!answer) return;
    spec.onSubmit(answer);
  });
  row.appendChild(ta);
  row.appendChild(sendBtn);
  wrap.appendChild(row);

  return { root: wrap, input: ta };
}

/** The read-only row a form is replaced with once it's answered or closed. */
export function buildResolvedAsk(idoc: Document, question: string, answer: string): HTMLElement {
  const replaced = el(idoc, 'div', 'ask-resolved');
  replaced.appendChild(el(idoc, 'div', 'ask-question', question));
  replaced.appendChild(el(idoc, 'div', 'ask-answer', answer));
  return replaced;
}
