// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { createResendEmailSender, EmailSendError, noopEmailSender } from '../src/sender';

type Call = { url: string; init: RequestInit | undefined };

function recordingFetch(status: number): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(status === 200 ? JSON.stringify({ id: 'eml_1' }) : 'bad', { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fn, calls };
}

const message = {
  to: 'bob@acme.com',
  subject: 'Hello',
  html: '<p>hi</p>',
  text: 'hi',
};

describe('createResendEmailSender', () => {
  it('POSTs the message to the Resend API with the bearer key and from header', async () => {
    const { fetch, calls } = recordingFetch(200);
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Pinagent <noreply@pinagent.dev>',
      fetch,
    });

    await sender.send(message);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.resend.com/emails');
    expect(call?.init?.method).toBe('POST');
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test');
    expect(JSON.parse(call?.init?.body as string)).toEqual({
      from: 'Pinagent <noreply@pinagent.dev>',
      to: 'bob@acme.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it('throws EmailSendError on a non-2xx response', async () => {
    const { fetch } = recordingFetch(422);
    const sender = createResendEmailSender({ apiKey: 're_test', from: 'x', fetch });
    await expect(sender.send(message)).rejects.toBeInstanceOf(EmailSendError);
  });
});

describe('noopEmailSender', () => {
  it('resolves without throwing', async () => {
    await expect(noopEmailSender.send(message)).resolves.toBeUndefined();
  });
});
