import { makeRequestId } from "@/types/sync";

export type AuditAction = "share_publish" | "share_rotate" | "share_revoke" | "import_json";
export type AuditEvent = {
  id: string;
  action: AuditAction;
  status: "success" | "error";
  userId?: string | null;
  targetId?: string | null;
  requestId?: string;
  message?: string;
  at: number;
};

const AUDIT_STORAGE_KEY = "audit_events_v1";
const MAX_EVENTS = 200;

const readAuditEvents = (): AuditEvent[] => {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuditEvent[]) : [];
  } catch {
    return [];
  }
};

const persistAuditEvents = (events: AuditEvent[]) => {
  try {
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn("[AuditTrail] persist failed", e);
    }
  }
};

export const recordAuditEvent = (input: Omit<AuditEvent, "id" | "at"> & { at?: number }) => {
  const event: AuditEvent = {
    id: makeRequestId(),
    at: input.at ?? Date.now(),
    ...input,
  };
  const next = [...readAuditEvents(), event];
  persistAuditEvents(next);
  if (import.meta.env.DEV) {
    console.info("[AuditTrail]", event);
  }
  return event;
};

export const getAuditEvents = () => readAuditEvents();
