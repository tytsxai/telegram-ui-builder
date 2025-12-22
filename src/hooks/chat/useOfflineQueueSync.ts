import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { KeyboardRow, Screen } from "@/types/telegram";
import type { TablesUpdate, Json } from "@/integrations/supabase/types";
import type { SaveScreenInput, SupabaseDataAccess } from "@/lib/dataAccess";
import {
  clearPendingOps,
  enqueueSaveOperation,
  enqueueUpdateOperation,
  processPendingOps,
  readPendingOps,
} from "@/lib/pendingQueue";
import { cloneKeyboard } from "@/lib/keyboard/factory";

type LastSavedSnapshot = { messageContent: string; keyboard: KeyboardRow[] } | null;

type OfflineQueueSyncArgs = {
  user: User | null;
  keyboard: KeyboardRow[];
  parseMode?: Screen["parse_mode"];
  messageType?: Screen["message_type"];
  mediaUrl?: string | null;
  currentScreenId?: string;
  serializeMessagePayload: () => string;
  dataAccess: SupabaseDataAccess;
  queueReplayCallbacks?: {
    onItemFailure?: Parameters<typeof processPendingOps>[0]["onItemFailure"];
    onSuccess?: Parameters<typeof processPendingOps>[0]["onSuccess"];
  };
  setScreens: React.Dispatch<React.SetStateAction<Screen[]>>;
  setCurrentScreenId: (id?: string) => void;
  setLastSavedSnapshot: React.Dispatch<React.SetStateAction<LastSavedSnapshot>>;
  setPendingQueueSize: (n: number) => void;
};

const safeRandomId = () => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      // @ts-expect-error randomUUID exists in modern browsers
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const useOfflineQueueSync = (args: OfflineQueueSyncArgs) => {
  const {
    user,
    keyboard,
    parseMode,
    messageType,
    mediaUrl,
    currentScreenId,
    serializeMessagePayload,
    dataAccess,
    queueReplayCallbacks,
    setScreens,
    setCurrentScreenId,
    setLastSavedSnapshot,
    setPendingQueueSize,
  } = args;

  const queuedToastShownRef = useRef(false);
  const [pendingOpsNotice, setPendingOpsNotice] = useState(false);
  const [retryingQueue, setRetryingQueue] = useState(false);
  const [pendingQueueVersion, setPendingQueueVersion] = useState(0);

  const refreshPendingQueueSize = useCallback(() => {
    const size = readPendingOps(user?.id).length;
    setPendingQueueSize(size);
    setPendingOpsNotice(size > 0);
    setPendingQueueVersion((prev) => prev + 1);
    if (size === 0) {
      queuedToastShownRef.current = false;
    }
  }, [setPendingQueueSize, user?.id]);

  useEffect(() => {
    refreshPendingQueueSize();
  }, [refreshPendingQueueSize]);

  const queueSaveOperation = useCallback(
    (payload: SaveScreenInput) => {
      const id = payload.id ?? safeRandomId();
      const queuedPayload = { ...payload, id };
      void (async () => {
        try {
          await enqueueSaveOperation(queuedPayload, user?.id);
        } catch (error) {
          console.error("[OfflineQueue] Failed to enqueue save:", error);
          toast.error("离线保存失败，可能无法恢复");
        } finally {
          refreshPendingQueueSize();
        }
      })();
      setScreens((prev) => [
        ...prev,
        {
          id,
          name: queuedPayload.name,
          message_content: queuedPayload.message_content,
          keyboard: cloneKeyboard(keyboard),
          parse_mode: parseMode,
          message_type: messageType,
          media_url: mediaUrl,
          share_token: queuedPayload.share_token ?? null,
          is_public: queuedPayload.is_public ?? false,
          created_at: new Date().toISOString(),
          updated_at: null,
          user_id: queuedPayload.user_id,
        } as Screen,
      ]);
      setCurrentScreenId(id);
      setPendingOpsNotice(true);
      if (!queuedToastShownRef.current) {
        toast.info("网络不可用，已排队保存请求");
        queuedToastShownRef.current = true;
      }
    },
    [keyboard, mediaUrl, messageType, parseMode, refreshPendingQueueSize, setCurrentScreenId, setScreens, user?.id],
  );

  const queueUpdateOperation = useCallback(
    (updatePayload: TablesUpdate<"screens">) => {
      if (!currentScreenId) return;
      void (async () => {
        try {
          await enqueueUpdateOperation({ id: currentScreenId, update: updatePayload }, user?.id);
        } catch (error) {
          console.error("[OfflineQueue] Failed to enqueue update:", error);
          toast.error("离线更新失败，可能无法恢复");
        } finally {
          refreshPendingQueueSize();
        }
      })();
      setScreens((prev) =>
        prev.map((s) =>
          s.id === currentScreenId
            ? ({
                ...s,
                message_content: updatePayload.message_content ?? s.message_content,
                keyboard: updatePayload.keyboard ? cloneKeyboard(updatePayload.keyboard as KeyboardRow[]) : s.keyboard,
                name: updatePayload.name ?? s.name,
                updated_at: updatePayload.updated_at ?? s.updated_at,
              } as Screen)
            : s,
        ),
      );
      setPendingOpsNotice(true);
      if (!queuedToastShownRef.current) {
        toast.info("网络不可用，更新已排队");
        queuedToastShownRef.current = true;
      }
    },
    [currentScreenId, refreshPendingQueueSize, setScreens, user?.id],
  );

  const replayPendingQueue = useCallback(async () => {
    if (!user) {
      refreshPendingQueueSize();
      return;
    }

    const queued = readPendingOps(user.id);
    if (queued.length === 0) {
      refreshPendingQueueSize();
      return;
    }

    setRetryingQueue(true);
    try {
      const remaining = await processPendingOps({
        userId: user.id,
        backoffMs: 400,
        maxAttempts: 3,
        ...(queueReplayCallbacks ?? {}),
        execute: async (item) => {
          if (item.kind === "save") {
            const saved = await dataAccess.saveScreen(item.payload);
            if (saved) {
              setScreens((prev) => {
                const idx = prev.findIndex((s) => s.id === (item.payload.id ?? (saved as Screen).id));
                if (idx === -1) return prev;
                const next = [...prev];
                next[idx] = { ...(saved as Screen), keyboard: (saved as Screen).keyboard as KeyboardRow[] } as Screen;
                return next;
              });
              setLastSavedSnapshot({
                messageContent: item.payload.message_content,
                keyboard: cloneKeyboard(item.payload.keyboard as KeyboardRow[]),
              });
              setCurrentScreenId((current) => current ?? (saved as Screen).id);
            }
          } else {
            const updated = await dataAccess.updateScreen({ screenId: item.payload.id, update: item.payload.update });
            setScreens((prev) =>
              prev.map((s) =>
                s.id === item.payload.id
                  ? ({ ...(updated as Screen), keyboard: (updated as Screen).keyboard as KeyboardRow[] } as Screen)
                  : s,
              ),
            );
            if (item.payload.update.message_content || item.payload.update.keyboard) {
              setLastSavedSnapshot({
                messageContent: (item.payload.update.message_content as string) ?? serializeMessagePayload(),
                keyboard: item.payload.update.keyboard
                  ? cloneKeyboard(item.payload.update.keyboard as KeyboardRow[])
                  : cloneKeyboard(keyboard),
              });
            }
          }
        },
        onPermanentFailure: () => {
          setPendingOpsNotice(true);
          toast.error("离线队列重试失败，请检查网络后重试");
        },
      });
      refreshPendingQueueSize();
      if (remaining.length === 0) {
        queuedToastShownRef.current = false;
        toast.success("离线队列已同步");
      }
    } finally {
      setRetryingQueue(false);
    }
  }, [
    dataAccess,
    keyboard,
    refreshPendingQueueSize,
    serializeMessagePayload,
    setCurrentScreenId,
    setPendingQueueSize,
    setScreens,
    queueReplayCallbacks,
    user,
    setLastSavedSnapshot,
  ]);

  const clearPendingQueue = useCallback(() => {
    clearPendingOps(user?.id);
    refreshPendingQueueSize();
    setPendingOpsNotice(false);
    toast.success("已清空离线队列");
  }, [refreshPendingQueueSize, user?.id]);

  return {
    pendingOpsNotice,
    pendingQueueVersion,
    retryingQueue,
    refreshPendingQueueSize,
    queueSaveOperation,
    queueUpdateOperation,
    replayPendingQueue,
    clearPendingQueue,
  };
};
