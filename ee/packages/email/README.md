<!-- SPDX-License-Identifier: Elastic-2.0 -->

# @pinagent/ee-email

Transactional email for the Pinagent cloud control plane: [React Email](https://react.email)
templates + a [Resend](https://resend.com) transport.

## Layout

- `emails/` — the templates (React Email components with `PreviewProps`),
  previewable in the browser. Add one file per email.
- `src/components/` — the shared branded shell (`Layout`) + brand constants.
- `src/render.ts` — `render*` helpers turning a template into `{ subject, html, text }`.
- `src/sender.ts` — the `EmailSender` transport port, `noopEmailSender`, and
  `createResendEmailSender` (a direct `fetch` to the Resend REST API — no SDK,
  so nothing lazy-imports `@react-email/render` in the Cloudflare Worker).
- `src/invitation-mailer.ts` — a high-level notifier composed over `EmailSender`.

## Preview templates

```bash
pnpm --filter @pinagent/ee-email email:dev   # opens the React Email preview
```

## Sending (in apps/cloud)

The Worker builds a `createResendEmailSender` when `RESEND_API_KEY` + `EMAIL_FROM`
are set, otherwise email is a no-op — so local/dev flows work unchanged. See
`apps/cloud/src/worker.ts`.

## Add a new email

1. Add `emails/MyEmail.tsx` (a template + `PreviewProps`).
2. Add `renderMyEmail(props)` in `src/render.ts`.
3. Expose a port method (or reuse `EmailSender.send`) and wire it where it's sent.
