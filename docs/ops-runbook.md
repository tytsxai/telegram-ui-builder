# Ops Runbook: Supabase Sync & Backoff

## Goals
- Keep Supabase writes reliable under rate limits and flaky networks.
- Provide request correlation and user-facing cues for sync status.

## Retry & Backoff
- Default: 3 attempts, linear backoff 350–500ms (`supabaseRetry` + `SupabaseDataAccess`).
- Request IDs: generated per operation (`makeRequestId`); injected into error logs and UI badges.
- Queue: `pendingQueue.processPendingOps` retries items with incremental backoff; drops after `maxAttempts` with optional onPermanentFailure hook.
- Tuning: increase attempts/backoff for known 429/5xx windows; avoid infinite retries—surface toasts + badges when backlog persists.

## Offline & Sync
- Pending writes stored per-user in localStorage (`pending_ops_v2_*`).
- Replay triggered when `isOffline` flips false; UI badge shows pending state.
- Layout sync: `TemplateFlowDiagram` emits `onLayoutSync` status; share flows emit status in center toolbar badges.

## Workbench Operations (entry/share, templates, keyboard, diagram)
- Entry + sharing: Entry choice is stored in `localStorage` (`telegram_ui_entry_screen`) and is required for exports/sharing; share/export is blocked if entry is missing or any button links to a deleted screen. Sidebar actions map to Supabase ops: “生成/复制入口链接” (publish + copy), “刷新链接” (rotate `share_token`), “取消公开” (revoke). Public page `/share/:token` reads via `get_public_screen_by_token` RPC (no broad SELECT policy), shows timestamps, and lets signed-in users copy into their account; sensitive content (wallet addresses) cannot be made public; badges carry requestId when share calls fail.
- Template library: Canvas toolbar button `模板库` fetches `public/templates/library.json` → individual template JSON files. If loading fails, use the refresh icon; verify the static files shipped with the build. Templates are pre-validated and mark onboarding as complete when applied.
- Keyboard guardrails: Inline editor enforces per-row/per-keyboard limits and 64B callback_data; red hint appears instead of saving invalid payloads. The button dialog validates URL vs callback vs link targets, autogenerates `goto_screen_<id>` callback_data for links, and appends a readable suffix to button text. Use this dialog to clear byte overflows before retrying saves.
- Flow diagram + layout persistence: “查看关系图” provides filters (focus current 2-hop, hide isolated, show button labels, mind map, compact) and right-click actions (edit, set entry, delete). “保存布局” writes positions to localStorage (`diagram_positions_<user>`) and Supabase `screen_layouts` with debounced autosave; “重置位置” clears both and reverts to Dagre auto layout. Connect nodes to create links; layout badge in the toolbar reflects sync state.

## Rate Limit Guidance
- Batch writes where possible (layout upsert uses bulk; import uses bulk insert).
- Avoid rapid save spam: debounce UI triggers; queue writes while offline.
- On 429/5xx: respect `Retry-After` if provided; otherwise backoff * attemptIndex.
- Supabase defaults: anon key ~6k RPM/table (subject to plan); adjust `retryAttempts/backoffMs` if you consistently see 429s.

## Monitoring Hooks
- Add structured logging sinks (e.g., Sentry/Logtail) that capture:
  - `requestId`, `action`, `table`, `userId`, `status`, `attempt`, `error.code/message`.
- UI telemetry: expose sync badge state changes and backlog length to analytics.
- Consider heartbeat: ping Supabase (lightweight select) every few minutes and surface degraded status in toolbar.

## Deployment Routing (SPA)
- Configure a rewrite so all non-asset routes serve `index.html` (e.g., `/share/:token`, `/auth`).
- Bundled configs: `public/_redirects` (Netlify/Cloudflare Pages), `netlify.toml` (build + redirects), `vercel.json` (rewrites).
- GitHub Pages SPA fallback uses `public/404.html` and is hardcoded to `/telegram-ui-builder/`; update if your repo/base path changes.
- Examples:
  - Netlify: `_redirects` with `/* /index.html 200`.
  - Vercel: `rewrites` to `/index.html`.
  - Nginx: `try_files $uri /index.html;`.

## Runtime Config Guard
- Production builds will show a configuration error screen if Supabase env values are missing or placeholders.
- Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set at build time.
- Supabase URL must be https in production (non-local).
- Service role keys are rejected on the client; never expose `SUPABASE_SERVICE_ROLE_KEY` via `VITE_*`.
- Set `VITE_ERROR_REPORTING_URL` in production to capture errors (warns if omitted).
- Set `VITE_APP_VERSION` or `VITE_COMMIT_SHA` to tag production error reports.
- Run `npm run check:env` (or `npm run build:prod`) in release pipelines to fail fast on bad env.

## Key Rotation (Supabase)
- Rotate anon keys on suspected leakage and update `VITE_SUPABASE_PUBLISHABLE_KEY` in your host.
- If rotating service role keys, update only server-side secrets (never `VITE_*`).
- After rotation: verify auth, share flow, and RLS smoke tests.

## Backup & Restore (Supabase)
- Enable scheduled backups in the Supabase project (or use PITR on paid tiers).
- Before risky schema changes, export `screens`, `user_pins`, `screen_layouts`.
- Restore drill:
  1) Restore backup into a new project or via PITR.
  2) Reapply migrations if needed (`supabase db push`).
  3) Update `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` and smoke test RLS.

## Release & Rollback
- Keep the last known good `dist/` artifact or deployment ID.
- Record release commit + migration versions in a changelog.
- Rollback: redeploy the previous build, revert DB changes if required, and verify share/auth routes.

## Recovery Steps
1) Confirm Supabase availability (status page / CLI ping).
2) Check client error logs with `requestId`; correlate with Supabase edge logs.
3) If backlog persists: export pending queue (localStorage) for debugging; allow user to clear with confirmation.
4) For schema drift: regenerate types (`npm run supabase:types`) and run `npm run lint && npm run build`.

## Playbooks
- **Share link failures**: retry with backoff; if persistent, keep template private and show error badge with requestId. Recreate token only after success.
- **Layout sync failures**: keep local positions; badge error; allow manual retry; do not block editing.
- **Import floods**: throttle bulk inserts; verify callback_data length and entry screen validity before write.

## Verification Commands
- `npm run lint && npm run test && npm run build`
- `npm audit --production`
