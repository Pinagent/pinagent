// SPDX-License-Identifier: Elastic-2.0
import type { RenderedEmail } from './render';

/** A transactional message addressed to one recipient. */
export interface EmailMessage extends RenderedEmail {
  to: string;
}

/**
 * Transport port — where a rendered email leaves the control plane. Kept
 * generic (no template knowledge) so every future email reuses it, and so the
 * adapter is swappable: {@link noopEmailSender} for dev/tests,
 * {@link createResendEmailSender} in production. Mirrors `ee-billing`'s
 * `BillingReporter` / `noopBillingReporter`.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Thrown when the provider rejects a send (carries the HTTP status + body). */
export class EmailSendError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`email send failed (${status})${detail ? `: ${detail}` : ''}`);
    this.name = 'EmailSendError';
  }
}

/** No-op transport — logs and succeeds. The default when no provider is configured. */
export const noopEmailSender: EmailSender = {
  async send(message: EmailMessage): Promise<void> {
    console.info(`[email:noop] would send "${message.subject}" to ${message.to}`);
  },
};

export interface ResendEmailSenderOptions {
  /** Resend API key (`re_…`). */
  apiKey: string;
  /** From header, e.g. `Pinagent <noreply@pinagent.dev>`. */
  from: string;
  /** Injected fetch for tests; defaults to the global. */
  fetch?: typeof fetch;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Resend-backed transport. Calls the Resend REST API directly with `fetch`
 * (no SDK) — Worker-native, and it never loads the SDK's lazy
 * `@react-email/render` import, which has caused bundler issues in workerd. We
 * pass already-rendered `html`/`text`, never a React element.
 */
export function createResendEmailSender(options: ResendEmailSenderOptions): EmailSender {
  const fetchFn: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    async send({ to, subject, html, text }: EmailMessage): Promise<void> {
      const res = await fetchFn(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ from: options.from, to, subject, html, text }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new EmailSendError(res.status, detail);
      }
    },
  };
}
