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
