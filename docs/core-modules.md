# Core Modules And Logic

This document explains where to make changes without breaking the current boundaries.

## Entry And Shell

| File | Role |
| --- | --- |
| `src/main.tsx` | Runtime config validation, telemetry default publisher, error reporting init, React root render. |
| `src/App.tsx` | Global providers, router, lazy pages, draggable GitHub repo badge. |
| `src/pages/Index.tsx` | Main workbench page. |
| `src/pages/Auth.tsx` | Supabase email/password login and sign-up. |
| `src/pages/Share.tsx` | Public share-token preview and copy-to-account flow. |

If a page adds a new route, update `src/App.tsx`, SPA rewrites, `docs/configuration.md`, and `docs/deployment.md`.

## Builder State Orchestration

`src/hooks/chat/useBuilderStore.tsx` is the central feature orchestrator. It owns:

- Current editor state and screen selection.
- Save/update/autosave behavior.
- Offline fallback when network/Supabase calls fail.
- Import JSON and file import.
- Telegram JSON export and flow export.
- Entry screen checks.
- Share publish/rotate/revoke.
- Template loading.
- Flow diagram link creation.
- Dialog state and panel props.
- Onboarding progress.
- Global save/undo/redo shortcuts.

Do not duplicate this orchestration in panel components. Add new workflows here or extract a dedicated hook/service when the logic is reusable and tested.

## Message And Keyboard Model

Canonical runtime types:

- `src/types/telegram.ts`
- `src/types/templates.ts`

Message state lives in `useChatState`:

- Plain text messages are stored as plain `message_content` when type is text and parse mode is HTML.
- Photo/video or non-default parse mode messages are serialized as JSON with `type`, `text`, `mediaUrl`, and `parse_mode`.
- `loadMessagePayload` accepts both plain text and serialized JSON for backward compatibility.
- `convertToTelegramFormat` creates the Telegram-compatible payload used by the JSON preview and codegen.

Keyboard state is an array of rows and buttons. Buttons can be URL buttons, callback buttons, or internal linked-screen buttons. Internal links export as `goto_screen_<screenId>` callback data.

Validation lives in `src/lib/validation.ts`:

- Message content: 1 to 4096 graphemes.
- Button text: 1 to 30 graphemes.
- `callback_data`: max 64 UTF-8 bytes.
- Buttons per row: max 8.
- Keyboard rows: max 100.
- URL protocols reject `javascript:`, `data:`, and `vbscript:`.
- Sensitive wallet/address-like content cannot be made public.

When changing any limit, update tests under `src/lib/__tests__`, UI copy if needed, and `docs/flow-export-format.md`.

## Screen Graph And Navigation

`useScreenNavigation` owns:

- `currentScreenId`
- local navigation history, capped at 100 entries
- entry screen id in `localStorage` key `telegram_ui_entry_screen`
- cleanup when deleted screens disappear

`referenceChecker` owns:

- reverse reference lookup
- circular reference detection
- strongly connected components
- circular edge highlighting
- descendant traversal
- relationship graph nodes/edges
- safe-delete checks

Share and export flows must reject missing entry screens and dangling screen links. Flow diagram actions should reuse `referenceChecker` instead of duplicating graph traversal.

## Persistence And Sync

`SupabaseDataAccess` is the single DB gateway. It handles:

- `screens` insert/update/delete/bulk insert
- `user_pins` upsert/fetch
- `screen_layouts` upsert/fetch/delete
- public share RPC lookup
- share publish/rotate/revoke
- typed payloads from generated Supabase types
- active-owner normalization for writes and stripping `user_id` from updates
- retry/backoff and structured error logging

`useSupabaseSync` handles:

- loading screens and pins for the authenticated user
- optimistic screen updates with rollback on failed concurrent updates
- pending/share/layout sync status
- queue replay telemetry callbacks
- data access instance scoped to `user.id`

`pendingQueue` and `useOfflineQueueSync` handle:

- local queue persistence under `pending_ops_v2_<userId|anon>`
- save/update queue item shapes
- update dedupe per screen id
- queue size cap and memory fallback on storage quota issues
- replay with backoff and max attempts
- state reconciliation after replay
- temporary local id replacement after queued saves return final Supabase ids, including linked screen ids, current navigation, and entry selection

New Supabase-backed features should follow this order:

1. Add migration/schema.
2. Regenerate `src/integrations/supabase/types.ts`.
3. Add methods to `SupabaseDataAccess`.
4. Wire through a hook (`useSupabaseSync` or a new focused hook).
5. Add UI props through `BuilderProvider`.
6. Add tests and docs.

## Public Share Flow

Entry point: `handleCopyOrShare`, `handleRotateShareLink`, and `handleUnshareScreen` in `useBuilderStore`.

Important invariants:

- User must be signed in.
- Entry screen must exist.
- No button may point to a deleted screen.
- Public content must pass `screenContainsSensitiveData`.
- Token generation requires secure browser random APIs.
- Public read must use `get_public_screen_by_token`; no broad table SELECT.
- `/share/:token` should not expose `user_id`.

If sharing fails with the DB constraint `screens_public_no_sensitive`, keep the screen private and show a user-facing failure.

## Import/Export And Codegen

Import paths:

- Import dialog accepts JSON text or selected file text.
- Max import size is 512 KB.
- Supported incoming formats include Telegram-style `text`, `reply_markup.inline_keyboard`, `photo`, `video`, and internal `message_content`/`keyboard`.
- Inline JSON apply path uses the same validators and audit trail.

Export paths:

- `editableJSON` is the Telegram-compatible single-message payload.
- `handleExportJSON` downloads `telegram-keyboard.json`.
- `exportFlowAsJSON` downloads `telegram-flow.json` with version, entry screen id, and screens.
- `useCodegen` generates framework starter snippets from `convertToTelegramFormat`.

Keep `docs/flow-export-format.md` aligned with any flow export changes.

## Templates

Static templates live in `public/templates/`:

- `library.json` indexes available templates.
- Individual template JSON files hold template payloads.
- `TemplateSelector` fetches and validates them before applying.

Template data should satisfy `TemplatePayload` and the same validation rules as editor state.

## Observability

- `syncTelemetry` is a pluggable publisher for share/layout/queue sync status.
- `useSupabaseSync` logs dev-only sync details and publishes sync events.
- `errorReporting` is a pluggable error reporter.
- `errorReportingClient` sends sanitized production errors to `VITE_ERROR_REPORTING_URL`.
- `ErrorBoundary` and global window handlers report runtime errors.
- `auditTrail` records local audit events for import and share operations.

For production integration, inject a telemetry/error sink early in app startup and keep request IDs in logs.

## Callback Factory Subpackage

`telegram-callback-factory/` is independent from the main SPA. It provides:

- callback generation with namespace/action/data
- parser and middleware
- router dispatch
- TTL/nonce helpers
- 64-byte length control

Run its build separately when changing it:

```bash
cd telegram-callback-factory
npm install
npm run build
```

Do not assume the root `npm run build` validates this package.
