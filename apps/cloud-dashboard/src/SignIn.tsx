// SPDX-License-Identifier: Elastic-2.0

/** Shown when the control plane returns 401 — kicks off the SSO login flow. */
export function SignIn() {
  return (
    <div className="signin">
      <h2>Sign in</h2>
      <p>Your session has expired or you're not signed in.</p>
      <a className="signin-button" href="/sso/start">
        Sign in with SSO
      </a>
    </div>
  );
}
