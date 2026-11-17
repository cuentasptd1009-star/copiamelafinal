# Frontend deployment

The API origin for this installation is `https://167-233-103-143.sslip.io`.
Set `VITE_API_URL` to that origin in both Cloudflare production and preview.
Production builds also have this VPS as their fallback, so a manual build without
Cloudflare's environment variables does not silently use the SPA as its API.
`BASE_URL` is only the frontend's path.

Build from the repository root:

```sh
VITE_API_URL=https://167-233-103-143.sslip.io pnpm --filter @workspace/super-tv build
```

Deploy `artifacts/super-tv/dist/public` to Pages. Preserve its `_worker.js` and
`_routes.json`: the Worker forwards `/api/*` for existing relative-URL clients
and the lite player. Static assets stay on Pages. External API rewrites in
`_redirects` must not replace this Worker with the SPA HTML.

Before publishing, run:

```sh
node --test scripts/api-origin.test.mjs scripts/pages-api-proxy.test.mjs
```

Validate `/home` with the normal startup timers and service worker enabled.
Check a fresh visit, a reload with an old cache, slow JavaScript initialization,
and the recovery screen after a render failure. Do not disable bootstrap timers
to make the normal-startup test pass. `__appStarted` means a React tree committed,
not merely that `root.render` was called. The watchdog must not write into the
React root, and a successful late boot must hide the recovery screen.

The service worker must not cache HTML responses under JavaScript asset URLs.
Cache upgrades must preserve local storage and the user's login.
