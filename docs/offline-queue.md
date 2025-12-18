# Offline Queue Contract (pending ops)

Purpose: preserve user intent when the network (or Supabase) is unavailable by queueing write operations locally and replaying them later.

## Storage key & versioning
- Storage key: `pending_ops_v2_<userId|anon>` in `localStorage`
- Version: `v2` is encoded in the key (see `src/lib/pendingQueue.ts`)
- Legacy migration: `pending_ops_<userId|anon>` (v1) is auto-migrated on read

Versioning rules (maintenance safety):
- Bump the version only when the persisted JSON shape changes in a way that cannot be read safely.
- When bumping the version, keep a migration path for at least one previous version and add/adjust tests in `src/lib/__tests__/pendingQueue.test.ts`.
- Treat this as data-durability code: accidental changes can drop queued writes.

## Queue item types
The queue stores an array of `PendingItem`:
- `kind: "save"`: inserts a new screen row (payload typed as `TablesInsert<"screens">`)
- `kind: "update"`: updates an existing screen by id (payload `{ id, update }`)

Each item also tracks:
- `attempts`, `createdAt`
- optional `lastAttemptAt`, `lastError`
- optional `failures[]` (recent failure history, capped)

## Dedupe behavior (important)
Updates are de-duped per screen id:
- When enqueueing an `update`, older updates with the same `payload.id` are removed first.
- Rationale: replay should apply the latest screen state, not every intermediate keystroke.
- Changing this can cause stale writes, replay storms, or unexpected final state.

## Replay semantics
Replay is orchestrated by higher-level code (currently via `useOfflineQueueSync`):
- Read the queue, execute items sequentially with retry/backoff, and persist remaining items.
- On success: remove the processed item and publish telemetry.
- On permanent failure: keep remaining items, surface a notice, and require user action (retry/clear/export).

Backoff and retry logic is shared with Supabase retry utilities (see `src/lib/supabaseRetry.ts`).

## Observability
Replay paths may publish sync telemetry with `scope: "queue"`:
- Event publisher API: `src/lib/syncTelemetry.ts`
- Suggested wiring: `docs/telemetry.md`

## User-facing behaviors
- The UI shows a “pending” badge/count when the queue is non-empty.
- Users can retry or clear the queue; some flows allow exporting the queue JSON for debugging.

