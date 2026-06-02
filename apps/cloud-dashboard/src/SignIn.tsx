// SPDX-License-Identifier: Elastic-2.0
'use client';

import { Button } from '@pinagent/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pinagent/ui/components/ui/card';
import { Input } from '@pinagent/ui/components/ui/input';
import { type FormEvent, useState } from 'react';
import { Field } from './form-controls';

/**
 * Build the `/sso/start` URL.
 *
 * `returnTo` brings the user back to the page they were on (preserving `?org=`
 * and the tab) instead of the server's default landing page. `email`
 * (optional) lets the server discover the IdP connection by domain — without
 * it, a bare `/sso/start` 400s on deployments that have no single default
 * connection configured.
 */
export function ssoStartHref(returnTo: string, email?: string): string {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  const trimmed = email?.trim();
  if (trimmed) params.set('email', trimmed);
  const query = params.toString();
  return query ? `/sso/start?${query}` : '/sso/start';
}

/** Shown when the control plane returns 401 — kicks off the SSO login flow. */
export function SignIn() {
  const [email, setEmail] = useState('');

  function start(e: FormEvent) {
    e.preventDefault();
    // Return to wherever we are now (keeps the org + tab) after login.
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = ssoStartHref(returnTo, email);
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <p className="text-sm text-muted-foreground">
          Your session has expired or you're not signed in.
        </p>
        <form className="flex w-full flex-col gap-3" onSubmit={start}>
          <Field label="Work email (optional)">
            <Input
              type="email"
              placeholder="you@acme.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="accent">
            Sign in with SSO
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
