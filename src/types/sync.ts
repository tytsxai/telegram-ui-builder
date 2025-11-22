export type SyncState = "idle" | "pending" | "success" | "error";

export interface SyncStatus {
  state: SyncState;
  requestId?: string;
  message?: string;
  at?: number;
}

export const makeRequestId = () => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      // @ts-expect-error randomUUID exists in modern runtimes
      return crypto.randomUUID() as string;
    }
  } catch (e) {
    void e;
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};
