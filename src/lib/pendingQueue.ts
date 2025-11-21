type PendingItem =
  | {
      kind: "save";
      payload: {
        name: string;
        message_content: string;
        keyboard: unknown;
      };
    }
  | {
      kind: "update";
      payload: {
        id: string;
        message_content: string;
        keyboard: unknown;
      };
    };

const buildKey = (userId?: string | null) => `pending_ops_${userId ?? "anon"}`;

export const savePendingOps = (items: PendingItem[], userId?: string | null) => {
  try {
    localStorage.setItem(buildKey(userId), JSON.stringify(items));
  } catch (e) {
    void e;
  }
};

export const readPendingOps = (userId?: string | null): PendingItem[] => {
  try {
    const raw = localStorage.getItem(buildKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as PendingItem[];
    }
    return [];
  } catch {
    return [];
  }
};

export const clearPendingOps = (userId?: string | null) => {
  try {
    localStorage.removeItem(buildKey(userId));
  } catch (e) {
    void e;
  }
};
