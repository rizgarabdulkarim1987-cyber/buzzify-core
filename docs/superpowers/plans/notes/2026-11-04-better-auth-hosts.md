# better-auth and several hosts (Task 1 finding, 2026-11-04)

- Installed: `better-auth` 1.7.10. It supports a dynamic base URL: `baseURL: { allowedHosts: string[], fallback?: string, protocol?: 'http' | 'https' | 'auto' }`
  (types: `node_modules/@better-auth/core/dist/types/init-options.d.mts:101-135`; resolution: `node_modules/better-auth/dist/context/helpers.mjs`).
- `allowedHosts` uses the same wildcard matching as `trustedOrigins`. An empty list throws at start; a request host outside the list throws unless `fallback` is set.
- `x-forwarded-host` is used only when `advanced.trustedProxyHeaders` is on. Behind the VPS proxy the `Host` header is preserved (plan, Task 6), so leave it off.
- Decision for Task 4: `baseURL: { allowedHosts: [studioHost, pharmacyHost, coreHost].filter(Boolean), fallback: BETTER_AUTH_URL, protocol: 'https' }` in production; a plain string in development. `trustedOrigins` lists `https://<each host>`. Cookies stay host-only (`cookiePrefix: 'studio'`, no `crossSubDomainCookies`).
- No per-host auth instance is needed, so the plan's fallback is dropped.
