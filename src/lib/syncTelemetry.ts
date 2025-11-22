import type { SyncStatus } from "@/types/sync";

export type SyncScope = "share" | "layout" | "queue";
export type SyncTelemetryEvent = {
  scope: SyncScope;
  status: SyncStatus;
};

type Publisher = (event: SyncTelemetryEvent) => void;

let publisher: Publisher | null = null;

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
      publisher(event);
    }
  } catch (e) {
    console.error("[SyncTelemetry] publish failed", e);
  }
};
