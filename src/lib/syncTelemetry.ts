import type { SyncStatus } from "@/types/sync";

export type SyncScope = "share" | "layout" | "queue";
export type SyncTelemetryMeta = {
  userId?: string | null;
  action?: string;
  targetId?: string;
};
export type SyncTelemetryEvent = {
  scope: SyncScope;
  status: SyncStatus;
  meta?: SyncTelemetryMeta;
  retentionDays?: number;
};

type Publisher = (event: SyncTelemetryEvent) => void;

let publisher: Publisher | null = null;

export const ALLOWED_FIELDS = ["action", "targetId"] as const;
export const DATA_RETENTION_DAYS = 30;

export const sanitizeTelemetryData = (event: SyncTelemetryEvent): SyncTelemetryEvent => {
  const { meta } = event;
  let sanitizedMeta: SyncTelemetryMeta | undefined;

  if (meta) {
    const nextMeta: SyncTelemetryMeta = {};
    for (const field of ALLOWED_FIELDS) {
      const value = meta[field];
      if (value == null) {
        continue;
      }
      nextMeta[field] = value;
    }

    if (Object.keys(nextMeta).length > 0) {
      sanitizedMeta = nextMeta;
    }
  }

  return {
    scope: event.scope,
    status: event.status,
    meta: sanitizedMeta,
    retentionDays: DATA_RETENTION_DAYS,
  };
};

export const setSyncTelemetryPublisher = (fn: Publisher | null) => {
  if (publisher && fn && publisher !== fn) {
    console.warn("[SyncTelemetry] Overwriting existing publisher");
  }
  publisher = fn;
};

export const getSyncTelemetryPublisher = () => publisher;

export const publishSyncEvent = (event: SyncTelemetryEvent) => {
  try {
    if (publisher) {
      publisher(sanitizeTelemetryData(event));
    }
  } catch (e) {
    console.error("[SyncTelemetry] publish failed", e);
  }
};
