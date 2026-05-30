// SPDX-License-Identifier: Elastic-2.0
import { buttonVariants } from '@pinagent/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pinagent/ui/components/ui/card';

/** Shown when the control plane returns 401 — kicks off the SSO login flow. */
export function SignIn() {
  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <p className="text-sm text-muted-foreground">
          Your session has expired or you're not signed in.
        </p>
        <a className={buttonVariants({ variant: 'accent' })} href="/sso/start">
          Sign in with SSO
        </a>
      </CardContent>
    </Card>
  );
}
