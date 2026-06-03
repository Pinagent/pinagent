---
"@pinagent/next-plugin": patch
---

Add a runtime `NODE_ENV === 'production'` guard to every Next route handler (GET/POST/PATCH/PUT/DELETE) so they're inert (404) in production even if the `route-noop` export condition isn't honoured by a custom server or bundler — a runtime belt to the existing build-time suspenders.
