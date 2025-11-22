# Sync Telemetry Wiring

Purpose: capture share/layout/queue sync state changes with requestIds to help debug Supabase interactions.

## Publisher API
- File: `src/lib/syncTelemetry.ts`
- Methods:
  - `setSyncTelemetryPublisher(fn)` to inject your analytics/logger
  - `publishSyncEvent({ scope, status })` called by app (share/layout/queue)
  - `getSyncTelemetryPublisher()` to retrieve current publisher
- Event shape: `{ scope: "share" | "layout" | "queue", status: { state, requestId?, message?, at? } }`

## Defaults
- If no publisher is set, events are logged to console via `logSyncEvent` in `TelegramChatWithDB`.

## How to hook up (examples)
- Sentry:
  ```ts
  import * as Sentry from "@sentry/react";
  import { setSyncTelemetryPublisher } from "@/lib/syncTelemetry";

  setSyncTelemetryPublisher((event) => {
    Sentry.addBreadcrumb({
      category: "sync",
      message: `${event.scope}:${event.status.state}`,
      data: event,
      level: "info",
    });
  });
  ```
- Logtail/Datadog:
  ```ts
  setSyncTelemetryPublisher((event) => {
    logtail.info("sync_event", event);
  });
  ```

## Dashboard ideas
- Track share success/error counts, layout save errors, and queue backlog length.
- Correlate by `requestId` to Supabase edge logs. Add user_id/session if available (respect PII rules).
