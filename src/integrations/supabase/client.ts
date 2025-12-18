/**
 * Supabase client factory used by the frontend runtime.
 *
 * Env vars:
 * - `VITE_SUPABASE_URL`
 * - `VITE_SUPABASE_PUBLISHABLE_KEY` (anon/publishable key; safe to ship)
 *
 * Notes:
 * - CI/unit tests may not provide env vars; we use safe local fallbacks to keep the app buildable.
 * - Never put `SUPABASE_SERVICE_ROLE_KEY` (service role) into any `VITE_*` variable; it must never ship to browsers.
 */
import { createClient, type SupabaseClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "test-key";

const SHOULD_CONSOLE_LOG = import.meta.env.MODE !== "test";

if (SHOULD_CONSOLE_LOG && (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
  // CI/unit tests/build might not provide env vars; use safe fallbacks to keep the app buildable.
  // In production deployments, make sure to set real values.
  console.warn("Supabase env missing; falling back to local defaults (VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY).");
}

// 在非浏览器或受限环境下避免访问 localStorage 触发崩溃
const authStorage =
  typeof window !== "undefined" && typeof window.localStorage !== "undefined"
    ? window.localStorage
    : undefined;

const clientOptions: SupabaseClientOptions<Database> = {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
};

export const supabase: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  clientOptions,
);
