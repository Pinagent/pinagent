---
"@pinagent/nuxt-plugin": patch
---

fix(nuxt-plugin): annotate the module's default export to survive `@nuxt/schema` version skew

`defineNuxtModule`'s return type is `NuxtModule<…>` from `@nuxt/schema`. When the
workspace resolves more than one `@nuxt/schema` (e.g. an example app bumps `nuxt`
so `4.4.6` and `4.4.7` coexist), `tsc` infers the default export's type against a
non-portable `.pnpm/@nuxt+schema@x/…` path and fails with TS2883 ("inferred type
of 'default' cannot be named … not portable"). Annotate the export with an
explicit `NuxtModule<ModuleOptions>` (imported from the bare `@nuxt/schema`
specifier, now declared as a type-only devDependency) so the public type is
portably nameable regardless of which `@nuxt/schema` identity resolves — the same
decoupling the vite-plugin `addVitePlugin` cast already applies.
