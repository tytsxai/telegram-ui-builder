# Improvement Plan

Goal: ship a stable Telegram UI builder with reliable Supabase persistence, shareable flows, and maintainable code.

## P0 - Ship blockers
- [ ] **Type-safe Supabase and schema alignment** - Regenerate `src/integrations/supabase/types.ts` from the latest database (including `screens`, `user_pins`, `screen_layouts`), remove `fromUnsafe` usage, and make CI fail on unknown table names.
- [ ] **Reliable save and offline sync** - Centralize save/update/delete with retry and backoff, queue writes while `isOffline`, reconcile with local drafts from `useAutoSave`, and clear the unsaved indicator only after a confirmed remote write.
- [ ] **Refactor the builder monolith** - Break `src/components/TelegramChatWithDB.tsx` into focused hooks/components (persistence, navigation/preview, import/export, flow diagram), deduplicate state, and memoize expensive renders to keep typing and button edits responsive.
- [ ] **Automated coverage** - Add unit tests for `referenceChecker`, `validation`, `useUndoRedo`, and JSON import/export transforms, plus Playwright coverage for login -> create screen -> link button -> share/import. Wire lint and tests into CI.

## P1 - Product polish
- [ ] **Entry and share controls** - Let users pick an entry screen for exports, allow share/unshare/rotate share tokens, and show author/updated_at on the `/share/:token` page.
- [ ] **Template library and onboarding** - Seed sample flows, add a "Start from template" picker, and include a short in-app walkthrough covering edit vs preview, linking screens, and sharing.
- [ ] **Keyboard editor UX** - Support drag-to-reorder rows/buttons, enforce Telegram limits (rows per keyboard, buttons per row, 64-byte `callback_data`) inline, and surface validation errors before save/import.
- [ ] **Flow diagram usability** - Add click-to-filter or highlight by entry/pinned screens, badge nodes that are part of cycles, and provide a reset/view-all control that persists layout to cloud and local storage.

## P2 - Nice to have
- [ ] **Callback-data helper** - Integrate `telegram-callback-factory` to generate and parse `callback_data` with TTL/nonce options directly from the UI.
- [ ] **Observability** - Add structured error reporting around Supabase calls and import failures, plus lightweight usage events (save, share, import) to catch regressions.
