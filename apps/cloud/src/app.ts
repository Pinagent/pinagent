// SPDX-License-Identifier: Elastic-2.0
import { handleSsoCallback, handleSsoStart, type LoginServiceDeps } from './login-service';
import { handleSessionRequest, type SessionServiceDeps } from './session-service';

/**
 * The cloud control-plane HTTP surface, composed from the session + login
 * services. Framework-agnostic (`{ fetch }`), so `worker.ts` (or a Node
 * server) just builds the deps and forwards requests here.
 *
 *   GET  /sso/start            → begin IdP login
 *   GET  /sso/callback         → complete login, set session cookie
 *   POST /sessions             → exchange the session for a relay token
 *   GET  /healthz              → liveness
 */
export interface CloudAppDeps {
  session: SessionServiceDeps;
  login: LoginServiceDeps;
}

export function createCloudApp(deps: CloudAppDeps): { fetch(request: Request): Promise<Response> } {
  return {
    fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);
      switch (pathname) {
        case '/sso/start':
          return handleSsoStart(request, deps.login);
        case '/sso/callback':
          return handleSsoCallback(request, deps.login);
        case '/sessions':
          return handleSessionRequest(request, deps.session);
        case '/healthz':
          return Promise.resolve(new Response('ok', { status: 200 }));
        default:
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            }),
          );
      }
    },
  };
}
