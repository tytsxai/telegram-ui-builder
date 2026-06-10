# Operations And Troubleshooting

Use this guide for production checks, incident handling, and symptom-based debugging. For sync/backoff details, also read `docs/ops-runbook.md`.

## Health Checks

Static app health:

```bash
curl -fsS https://<host>/health.json
```

Expected response:

```json
{
  "status": "ok",
  "service": "telegram-ui-builder"
}
```

Route checks:

- `/` renders the builder shell.
- `/auth` renders Supabase login.
- `/share/<known-valid-token>` renders a public preview.
- A hard refresh on `/auth` and `/share/<token>` returns the SPA, not a server 404.

Local checks:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Production preflight:

```bash
npm run check:env
npm run pre-deploy
```

Supabase/security checks:

```bash
npm run security:scan
npm run security:verify
npm run smoke:rls
npm run verify:migrations
```

`security:verify`, `smoke:rls`, and `verify:migrations` require Supabase URL and service-role credentials in a server/CI context.

## Incident Workflow

1. Identify the failing layer: static host, browser config, Supabase auth, Supabase RLS/schema, offline queue, or a UI logic regression.
2. Capture release commit, host/deployment id, Supabase project, browser console error, and visible requestId if present.
3. Check `/health.json` and SPA rewrites before debugging application logic.
4. Check runtime config warnings/errors in the browser console.
5. Check Supabase availability, RLS policies, and recent migrations.
6. If the issue is a release regression, rollback static assets first. If migrations caused data/security issues, follow the migration rollback plan separately.
7. After mitigation, add or update tests/docs for the exact failure mode.

## Troubleshooting Matrix

| Symptom | Likely cause | What to check | Fix |
| --- | --- | --- | --- |
| Production shows configuration error | Bad `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser console and `npm run check:env` | Set real https Supabase URL and anon/publishable key; rebuild and redeploy. |
| `build:prod` fails before Vite build | Env precheck blocked deploy | Output from `scripts/ops/verify-env.mjs` | Fix missing/placeholder/insecure env. Use `npm run build` only for local non-production checks. |
| `/auth` or `/share/:token` hard refresh returns 404 | Missing SPA rewrite | Host config, `vercel.json`, `netlify.toml`, Nginx `try_files` | Route all non-asset paths to `index.html`. |
| GitHub Pages share links route incorrectly | Base path mismatch | Pages workflow `--base`, `public/404.html`, `BASE_URL` | Keep all three aligned to the repository path. |
| Login/signup fails | Supabase Auth disabled, wrong URL/key, redirect URL not allowed | Supabase Auth settings, browser network tab | Enable email/password auth, add deployed origin/base path to redirect allowlist, rebuild with correct env. |
| Screens do not load after login | RLS/schema drift or bad user-scoped query | Supabase logs, `screens` policies, generated types | Apply migrations, verify RLS, regenerate types, rerun build/tests. |
| Save/update fails while online | RLS, network, schema mismatch, or validation failure | Toast, console, sync requestId, Supabase logs | Fix validation data, RLS policy, schema/types drift, or Supabase availability. |
| Edits show pending queue | Browser is offline or network error triggered fallback | Status bar pending count, localStorage `pending_ops_v2_<userId>` | Restore network and use retry. Export queue before clearing if data matters. |
| Pending queue never clears | Replay fails repeatedly or storage data is stale | Queue item `lastError`, telemetry, Supabase logs | Fix root cause, retry. Clear only after confirming queued edits are no longer needed. |
| Public share link says invalid | Token revoked, screen not public, RPC missing, or wrong project | `screens.is_public`, `share_token`, RPC exists | Republish/rotate token or apply schema/RPC migrations. |
| Public share blocked for a screen | Sensitive data guard hit | UI toast, DB constraint `screens_public_no_sensitive` | Remove sensitive content or keep screen private. Do not bypass the constraint. |
| Layout positions or pins do not persist | `screen_layouts`/`user_pins` missing or RLS denied | Supabase table/policy, console errors | Apply migrations and verify owner-only policies. |
| E2E cannot connect to dev server | Port mismatch or blocked 8080 | Playwright output, `vite.config.ts` | Free port 8080 or update Playwright and Vite together. |
| Supabase types check fails | Live schema differs from generated types | `git diff src/integrations/supabase/types.ts` | Confirm target project, rerun `SUPABASE_PROJECT_REF=<ref> npm run supabase:types`, commit intended diff. |
| Security verify cannot query catalog | Missing `exec_sql` helper or insufficient service credentials | Script output from `verify-security` | Add required helper/permissions or run with correct service role in a trusted environment. |

## Offline Queue Recovery

The queue is per user and stored in localStorage. For a signed-in user:

```js
localStorage.getItem("pending_ops_v2_<userId>")
```

Recovery rules:

- Do not clear queue data until the user confirms queued edits can be discarded.
- Export/copy the queue JSON before manual deletion.
- Replay applies items in order; `update` items are deduped per screen id so the latest edit wins.
- If localStorage is full, the app may fall back to an in-memory queue for the current session only.

## Rollback

Static asset rollback:

1. Redeploy previous Vercel/Netlify/Pages deployment or previous server/container artifact.
2. Verify `/health.json`, `/`, `/auth`, and a known share route.
3. Confirm the app was built against the intended Supabase project.

Database rollback:

- Prefer forward migrations for simple fixes.
- Before risky schema changes, export `screens`, `user_pins`, and `screen_layouts`.
- For destructive migration rollback, restore into a separate Supabase project or use PITR if available, then repoint frontend env only after smoke checks pass.

## Logs And Observability

Useful client-side identifiers:

- sync `requestId` from share/layout/queue status
- `action`, `targetId`, and `userId` metadata from `syncTelemetry`
- sanitized error payloads from `errorReportingClient`

Recommended production sink:

- error reporter for `ErrorBoundary`, global errors, and unhandled rejections
- sync event logger for share/layout/queue status changes
- Supabase logs correlated by user id, table, action, and time window

Keep tokens, passwords, service keys, and auth headers out of logs.
