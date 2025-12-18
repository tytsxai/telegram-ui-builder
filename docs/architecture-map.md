# Architecture Map (B0-T1)

Current view of the Telegram builder modules, key dependencies, and risk guardrails to support upcoming decomposition.

## Module map (scanned scope)
| Module | Responsibilities | Key dependencies / coupling |
| --- | --- | --- |
| `src/components/TelegramChatWithDB.tsx` | Legacy entry wrapper that renders the workbench root. Most orchestration lives in builder hooks/components (see `BuilderRoot`/`useBuilderStore`). | Minimal; delegates to the builder root. |
| `src/hooks/chat/useBuilderStore.tsx` | Main workbench orchestrator: wires auth, state, persistence calls, offline queue, import/export/codegen, share tokens, dialogs, navigation. | Chat hooks (`useChatState`, `useKeyboardActions`, `useSupabaseSync`, `useScreenNavigation`), `pendingQueue`, `referenceChecker`, `validation`, Supabase client, workbench UI. High coupling surface. |
| `src/hooks/chat/useOfflineQueueSync.ts` | Encapsulates offline queue enqueue/replay/clear behavior and UI-facing flags (`pendingOpsNotice`, `retryingQueue`). | `pendingQueue`, `SupabaseDataAccess`, toast side-effects; coupled to `useBuilderStore` snapshot semantics. |
| `src/hooks/chat/useSupabaseSync.ts` | Loads/persists screens, pins, and layout sync status; wraps `SupabaseDataAccess` and publishes sync telemetry. Owns share/layout status state. | Supabase client, `SupabaseDataAccess`, `publishSyncEvent`, toast side-effects. Assumes `user_id` RLS filter. |
| `src/lib/dataAccess.ts` | Single gateway for Supabase CRUD with retry/backoff and structured logging; shapes payloads via `TablesInsert/Update`. | Supabase client, `supabaseRetry`, generated Supabase types. Encodes table/column names and share token semantics. |
| `src/lib/pendingQueue.ts` | Offline write queue in `localStorage` (`pending_ops_v2_<userId>`); enqueue/dedupe updates, migrate v1 queue, retry bookkeeping/backoff. | Supabase types, `supabaseRetry` (backoff), `publishSyncEvent` side-effects expected. Coupled to container replay logic. |
| `src/hooks/chat/useChatState.ts` | Message + keyboard state, undo/redo history, serialization (`serializeMessagePayload`), Telegram export (`convertToTelegramFormat`), parse mode/media handling. | `validation` for import/apply, `KeyboardRow/Button` types, history semantics used by keyboard actions and codegen. |
| `src/hooks/chat/useKeyboardActions.ts` | Keyboard mutation helpers with history push and limit enforcement. | `validation` constants (row/button caps), toast notifications, `useChatState` history contract. |
| `src/hooks/chat/useScreenNavigation.ts` | Tracks current/entry screen + navigation history; persists entry id (`telegram_ui_entry_screen`). | `Screen` type; depends on caller to keep screens list fresh. Entry selection feeds flow diagram/share. |
| `src/lib/referenceChecker.ts` | Graph utilities (reverse refs, cycles, descendant traversal, graph nodes/edges, safe delete). | `Screen` + keyboard types; used by flow diagram and delete/share guardrails. |
| `src/lib/validation.ts` | Telegram limits encoded via zod (message length, callback_data bytes, max rows/buttons). | `KeyboardRow` types; consumed by container, importer, keyboard actions. Changes ripple into autosave/save/import. |
| `src/lib/supabaseRetry.ts` / `src/lib/syncTelemetry.ts` | Retry classifier/backoff/logging for Supabase, pluggable telemetry publisher. | Used by `dataAccess`, `pendingQueue`, `useSupabaseSync`; requestId handling underpins sync logs. |

## Shared protocols & impact radius
- **`src/types/telegram.ts`**: Canonical keyboard/screen contract for UI, validation, reference checks, codegen, and Supabase payload serialization. Shape changes impact import/export, pending queue snapshots, and navigation.
- **`src/integrations/supabase/types.ts`**: Generated DB contract (`screens`, `user_pins`, `screen_layouts`). Drives `TablesInsert/Update` typing across `dataAccess`, queue payloads, and sync hooks; drift from DB breaks persistence/offline replay.
- **Local storage keys**: `telegram_ui_entry_screen` (entry selection) and `pending_ops_v2_<userId>` (offline writes; v1 migration baked in). Changes require migration and replay validation.
- **Supabase client usage**: `useSupabaseSync` + `SupabaseDataAccess` assume RLS-scope via `user_id` and shape compatibility with `Screen` (keyboard JSON). Share token publish/rotate lives in `dataAccess`.

## Coupling / boundary notes
- `useBuilderStore` blends UI wiring with persistence, offline replay, codegen, navigation, and share flows; decomposition should isolate persistence/queue service, import/export/codegen pipeline, navigation/graph module, and presentation-only workbench.
- `useChatState` serialization and Telegram export feed both Supabase storage and codegen; divergence risks broken imports/previews. History contract is assumed by keyboard actions.
- Offline queue replay couples `pendingQueue` with `SupabaseDataAccess` behavior and `user.id` scoping; in-flight edits rely on container-managed `lastSavedSnapshot`, not queue state.
- Reference/graph utilities are pure but tightly bound to keyboard shape; keep delete/share guards co-located with flow diagram logic to avoid duplication.
- Prefer a single orchestration module (currently `useBuilderStore`) consumed by all entry points to avoid behavioral drift.

## High-risk files & unique-writer suggestions
- `src/hooks/chat/useBuilderStore.tsx`: High coupling surface (auth, sync, import/export, codegen, navigation, offline). TL/pairing-only until decomposition; keep orchestration single-sourced.
- `src/hooks/chat/useSupabaseSync.ts`: Sole orchestrator of remote reads/writes and sync status; coupled to Supabase schema/RLS. Keep with backend/Supabase owner.
- `src/lib/dataAccess.ts`: Single gateway for DB tables + retry policy + share token actions; schema/RLS adjustments must originate here. Treat as owner-controlled (unique writer).
- `src/lib/pendingQueue.ts`: Offline durability/dedupe logic and storage versioning; data-loss risk on changes. Assign to reliability owner and version keys on shape changes.
- `src/types/telegram.ts` & `src/integrations/supabase/types.ts`: Shared contracts; require cross-team signoff and regen process for any changes.
- `src/hooks/chat/useChatState.ts` & `src/lib/validation.ts`: Control serialization, formatting, and Telegram constraints before save/export/codegen; coordinate updates with import/export and keyboard UI owners.

## Suggested boundaries for upcoming split (B0 track)
- Extract persistence/queue orchestration (Supabase + `pendingQueue` replay + sync telemetry) into a shared service hook used by both container entry points.
- Encapsulate import/export/codegen atop `useChatState` transforms; expose a pure API to the UI.
- Isolate navigation + flow graph (`useScreenNavigation`, `referenceChecker`) as a screen-graph module decoupled from keyboard editing and persistence.
- Guard Supabase schema/types regeneration and `dataAccess` changes behind single-writer ownership + CI drift check to prevent contract skew.
