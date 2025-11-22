# Improvement Plan

Goal: ship a production-grade Telegram UI builder with reliable Supabase persistence, shareable flows, and maintainable code.

## Execution Roadmap (Phased, with Acceptance)

### P0 - Ship Blockers (must-pass gates)
- [ ] **Schema + Types lockstep**
  - Actions: Regenerate `src/integrations/supabase/types.ts` from live DB (tables: `screens`, `user_pins`, `screen_layouts`, relationships). Delete `fromUnsafe` usages. Add CI check that fails on unknown tables/type drift.
  - Acceptance: `npm run lint && npm run build && npm run test` pass on fresh types; CI fails if `types.ts` differs from DB; no stringly `.from("...")`.
- [ ] **Reliable save + offline sync**
  - Actions: Centralize save/update/delete in a data access layer with retry/backoff; queue writes while `isOffline`, persist to local, and replay with ordered retries; reconcile with `useAutoSave` drafts; unsaved indicator clears only after confirmed remote write.
  - Acceptance: Simulated offline → edits queued → on reconnect they replay and clear; duplicate writes deduped by request id; toast only on failure; logs include request_id/user_id/table/action.
- [ ] **Builder decomposition**
  - Actions: Split `src/components/TelegramChatWithDB.tsx` into hooks/components for persistence, navigation/preview, import/export, flow diagram; memoize heavy renders; share state via providers or centralized stores to avoid prop drilling.
  - Acceptance: Main component <500 LOC; renders on typing stay under 60ms (React profiler); no duplicate state sources for screens/entry/pins.
- [ ] **Automated coverage**
  - Actions: Unit tests for `referenceChecker`, `validation`, `useUndoRedo`, import/export transforms, sync queue; Playwright path login → create screen → link button → export/import → share page; wire lint/tests/build into CI.
  - Acceptance: Coverage ≥80% on targeted modules; e2e passes in CI; pipeline blocks merges on failures.

### P1 - Product Polish (user-visible reliability)
- [ ] **Entry + share controls**
  - Actions: Entry screen picker for exports; share token management (create/rotate/revoke); `/share/:token` shows author/updated_at and entry screen preview.
  - Acceptance: Rotated token invalidates old link; private token 403; exported JSON respects chosen entry.
- [ ] **Template library + onboarding**
  - Actions: Seed starter flows; “Start from template” picker; guided walkthrough (edit vs preview, linking, share).
  - Acceptance: New user can reach a runnable flow in <60s; walkthrough dismissal persists; template import leaves no validation errors.
- [ ] **Keyboard editor UX**
  - Actions: Drag-to-reorder rows/buttons; inline enforcement of Telegram limits (row/button count, 64-byte `callback_data`); surfaced validation before save/import.
  - Acceptance: Invalid configs blocked with inline error; drag reorder persists to save; callback_data over 64 bytes rejected with counter.
- [ ] **Flow diagram usability**
  - Actions: Filter/highlight by entry/pinned; badge cycles; reset/view-all control; persist layout cloud + local.
  - Acceptance: Cycle nodes visibly badged; layout restore works across sessions; filter toggles re-render under 50ms on medium graphs.

### P2 - Extensions / Observability
- [ ] **Callback-data helper**
  - Actions: Integrate `telegram-callback-factory` to generate/parse `callback_data` with TTL/nonce; expose UI helper.
  - Acceptance: Generated payloads validated before save/import; helper warns when payload >64 bytes.
- [ ] **Observability + audit**
  - Actions: Structured error reporting around Supabase calls/import failures; lightweight usage events (save/share/import); audit events for token rotate/revoke/import.
  - Acceptance: Dashboards show save success rate, sync queue backlog, share success; audit log includes actor, action, target, status, timestamp.

## Rolling Checklist (runbook style)
- [ ] Regen Supabase types → lint/build/test → commit types
- [ ] Land data access layer + sync queue with retries/backoff + structured logs
- [ ] Wire queue into save/update/delete/pin/layout flows + offline replay + UI badges
- [ ] Split builder container into focused hooks/components; memoize heavy blocks
- [ ] Ship unit tests (referenceChecker, validation, undo/redo, import/export, sync queue)
- [ ] Add Playwright e2e happy path + offline replay check
- [ ] CI: lint + typecheck + test + build, plus PR preview deploy
- [ ] Ship entry/share management, template library, onboarding
- [ ] Harden keyboard editor + flow diagram UX and persistence
- [ ] Add observability, audit, and callback-data helper
