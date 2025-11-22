import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate, Database } from "@/integrations/supabase/types";
import { withRetry, logSupabaseError } from "./supabaseRetry";

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

  constructor(private readonly client = supabase, options: DataAccessOptions = {}) {
    this.userId = options.userId;
    this.retryAttempts = options.retryAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 400;
  }

  async saveScreen(payload: SaveScreenInput) {
    return this.run("insert", "screens", async () => {
      const { data, error } = await this.client
        .from("screens")
        .insert([payload])
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

  async getPublicScreenByToken(token: string): Promise<ScreenRow | null> {
    return this.run("select", "screens", async () => {
      const { data, error } = await this.client
        .from("screens")
        .select("id,name,message_content,keyboard,share_token,is_public,updated_at,created_at,user_id")
        .eq("share_token", token)
        .eq("is_public", true)
        .single();
      if (error) throw error;
      return (data as ScreenRow) ?? null;
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

  private async run<T>(action: string, table: string, op: () => Promise<T>): Promise<T> {
    const requestId = safeUUID();
    try {
      return await withRetry(() => op(), { attempts: this.retryAttempts, backoffMs: this.backoffMs });
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
