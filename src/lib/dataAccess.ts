import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate, Database } from "@/integrations/supabase/types";
import { withRetry, logSupabaseError, type RetryEvent } from "./supabaseRetry";

export type SaveScreenInput = TablesInsert<"screens">;
export type UpdateScreenInput = {
  screenId: string;
  update: TablesUpdate<"screens">;
};

export type DeleteScreensInput = {
  ids: string[];
  userId: string;
};

export type UpsertPinsInput = TablesInsert<"user_pins">;
export type UpsertLayoutsInput = TablesInsert<"screen_layouts">[];

export interface DataAccessOptions {
  userId?: string | null;
  retryAttempts?: number;
  backoffMs?: number;
  jitterRatio?: number;
  onRetry?: (event: RetryEvent & { action: string; table: string; userId?: string | null }) => void;
}

type ScreenRow = Database["public"]["Tables"]["screens"]["Row"];
type LayoutRow = Database["public"]["Tables"]["screen_layouts"]["Row"];

/**
 * SupabaseDataAccess centralizes persistence operations with retries,
 * typed table names, and structured error logging.
 */
export class SupabaseDataAccess {
  private readonly userId?: string | null;
  private readonly retryAttempts: number;
  private readonly backoffMs: number;
  private readonly jitterRatio: number;
  private readonly onRetry?: DataAccessOptions["onRetry"];

  constructor(private readonly client = supabase, options: DataAccessOptions = {}) {
    this.userId = options.userId;
    this.retryAttempts = options.retryAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 400;
    this.jitterRatio = options.jitterRatio ?? 0.25;
    this.onRetry = options.onRetry;
  }

  async saveScreen(payload: SaveScreenInput) {
    const targetUserId = payload.user_id ?? this.userId;
    if (!targetUserId) {
      throw new Error("saveScreen requires userId");
    }
    const nextPayload: SaveScreenInput = { ...payload, user_id: targetUserId };
    return this.run("insert", "screens", async () => {
      const { data, error } = await this.client
        .from("screens")
        .insert([nextPayload])
        .select()
        .single();
      if (error) throw error;
      return data;
    });
  }

  async insertScreens(payload: SaveScreenInput[]): Promise<ScreenRow[]> {
    if (payload.length === 0) return [];
    return this.run("insert_many", "screens", async () => {
      const { data, error } = await this.client.from("screens").insert(payload).select();
      if (error) throw error;
      return (data ?? []) as ScreenRow[];
    });
  }

  async updateScreen(params: UpdateScreenInput) {
    const targetUserId = params.update.user_id ?? this.userId;
    if (!targetUserId) {
      throw new Error("updateScreen requires userId");
    }

    return this.run("update", "screens", async () => {
      const { data, error } = await this.client
        .from("screens")
        .update(params.update)
        .eq("id", params.screenId)
        .eq("user_id", targetUserId)
        .select()
        .single();
      if (error) throw error;
      return data;
    });
  }

  async deleteScreens(params: DeleteScreensInput) {
    return this.run("delete", "screens", async () => {
      const { error } = await this.client.from("screens").delete().eq("user_id", params.userId).in("id", params.ids);
      if (error) throw error;
      return params.ids;
    });
  }

  async upsertPins(payload: UpsertPinsInput) {
    return this.run("upsert", "user_pins", async () => {
      const { error } = await this.client.from("user_pins").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      return payload;
    });
  }

  async fetchPins(params: { userId: string }): Promise<string[]> {
    return this.run("select", "user_pins", async () => {
      const { data, error } = await this.client
        .from("user_pins")
        .select("pinned_ids")
        .eq("user_id", params.userId)
        .single();
      if (error && error.code !== "PGRST116") throw error;
      return (data?.pinned_ids as string[]) ?? [];
    });
  }

  async upsertLayouts(payload: UpsertLayoutsInput) {
    if (payload.length === 0) return [];
    return this.run("upsert", "screen_layouts", async () => {
      const { error } = await this.client.from("screen_layouts").upsert(payload, { onConflict: "user_id,screen_id" });
      if (error) throw error;
      return payload;
    });
  }

  async deleteLayouts(params: { userId: string; ids?: string[] }) {
    return this.run("delete", "screen_layouts", async () => {
      const query = this.client.from("screen_layouts").delete().eq("user_id", params.userId);
      if (params.ids && params.ids.length > 0) {
        query.in("screen_id", params.ids);
      }
      const { error } = await query;
      if (error) throw error;
      return params.ids ?? [];
    });
  }

  async fetchLayouts(params: { userId: string; ids: string[] }): Promise<LayoutRow[]> {
    if (params.ids.length === 0) return [];
    return this.run("select", "screen_layouts", async () => {
      const { data, error } = await this.client
        .from("screen_layouts")
        .select("screen_id,x,y")
        .eq("user_id", params.userId)
        .in("screen_id", params.ids);
      if (error) throw error;
      return (data ?? []) as LayoutRow[];
    });
  }

  async getPublicScreenByToken(token: string, options?: { signal?: AbortSignal }): Promise<ScreenRow | null> {
    return this.run("select", "screens", async () => {
      const baseQuery = this.client.rpc("get_public_screen_by_token", { token });
      const query = options?.signal && "abortSignal" in baseQuery
        // @ts-expect-error supabase-js v2 supports abortSignal
        ? baseQuery.abortSignal(options.signal)
        : baseQuery;
      const { data, error } = await query;
      if (error) throw error;
      const normalized = Array.isArray(data) ? data[0] : data;
      return (normalized as ScreenRow) ?? null;
    });
  }

  async copyScreenForUser(source: ScreenRow, userId: string, options?: { nameSuffix?: string }) {
    const nameSuffix = options?.nameSuffix ?? " (副本)";
    const payload: SaveScreenInput = {
      user_id: userId,
      name: `${source.name}${nameSuffix}`,
      message_content: source.message_content,
      keyboard: source.keyboard,
      is_public: false,
      share_token: null,
    };
    return this.saveScreen(payload);
  }

  async publishShareToken(params: { screenId: string; token: string }) {
    const targetUserId = this.userId;
    if (!targetUserId) {
      throw new Error("publishShareToken requires userId");
    }

    return this.run("share_publish", "screens", async () => {
      const { data, error } = await this.client
        .from("screens")
        .update({ share_token: params.token, is_public: true })
        .eq("id", params.screenId)
        .eq("user_id", targetUserId)
        .select()
        .single();
      if (error) throw error;
      return data as ScreenRow;
    });
  }

  async rotateShareToken(screenId: string, token: string) {
    const targetUserId = this.userId;
    if (!targetUserId) {
      throw new Error("rotateShareToken requires userId");
    }

    return this.run("share_rotate", "screens", async () => {
      const { data, error } = await this.client
        .from("screens")
        .update({ share_token: token, is_public: true })
        .eq("id", screenId)
        .eq("user_id", targetUserId)
        .select()
        .single();
      if (error) throw error;
      return data as ScreenRow;
    });
  }

  async revokeShareToken(screenId: string) {
    const targetUserId = this.userId;
    if (!targetUserId) {
      throw new Error("revokeShareToken requires userId");
    }

    return this.run("share_revoke", "screens", async () => {
      const { data, error } = await this.client
        .from("screens")
        .update({ share_token: null, is_public: false })
        .eq("id", screenId)
        .eq("user_id", targetUserId)
        .select()
        .single();
      if (error) throw error;
      return data as ScreenRow;
    });
  }

  private async run<T>(action: string, table: string, op: () => Promise<T>): Promise<T> {
    const requestId = safeUUID();
    try {
      return await withRetry(() => op(), {
        attempts: this.retryAttempts,
        backoffMs: this.backoffMs,
        jitterRatio: this.jitterRatio,
        requestId,
        onRetry: this.onRetry
          ? (event) =>
              this.onRetry?.({
                ...event,
                action,
                table,
                userId: this.userId,
              })
          : undefined,
      });
    } catch (error) {
      logSupabaseError({ action, table, userId: this.userId ?? undefined, error, requestId });
      throw error;
    }
  }
}

const safeUUID = () => {
  try {
    // @ts-expect-error browser crypto
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      // @ts-expect-error randomUUID polyfill for browsers
      return crypto.randomUUID();
    }
  } catch (e) {
    void e;
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};
