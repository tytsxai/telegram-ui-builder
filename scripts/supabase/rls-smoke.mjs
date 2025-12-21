import { createClient } from "@supabase/supabase-js";

const env = {
  url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
};

if (!env.url || !env.anonKey || !env.serviceKey) {
  console.error("Missing Supabase env: require SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY), SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const password = `Smoke!${Math.random().toString(16).slice(2, 8)}A`;

const admin = createClient(env.url, env.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(env.url, env.anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];

const check = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${name}: ${message}`);
    results.push({ name, message });
  }
};

const randomEmail = (label) => `rls-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

const createUser = async (label) => {
  const email = randomEmail(label);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw error || new Error("Failed to create user");
  }
  return { ...data.user, email };
};

const signIn = async (email) => {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw error || new Error("Sign-in failed");
  }
  return data.session;
};

const clientFor = (token) =>
  createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

const normalizeRpcRow = (data) => (Array.isArray(data) ? data[0] : data);

async function main() {
  let owner = null;
  let viewer = null;
  let screenId = "";
  let shareToken = `smoke_${Date.now()}`;
  let privateScreenId = "";
  let privateShareToken = `smoke_private_${Date.now()}`;

  try {
    owner = await createUser("owner");
    viewer = await createUser("viewer");

    const ownerSession = await signIn(owner.email);
    const viewerSession = await signIn(viewer.email);

    const ownerClient = clientFor(ownerSession.access_token);
    const viewerClient = clientFor(viewerSession.access_token);

    await check("owner can insert screen", async () => {
      const { data, error } = await ownerClient
        .from("screens")
        .insert([
          {
            user_id: owner.id,
            name: "Smoke Screen",
            message_content: "Hello from smoke",
            keyboard: [],
            is_public: false,
            share_token: null,
          },
        ])
        .select("id,user_id")
        .single();
      if (error) throw error;
      if (!data?.id || data.user_id !== owner.id) throw new Error("Insert failed RLS");
      screenId = data.id;
    });

    await check("owner can upsert pins", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { error } = await ownerClient
        .from("user_pins")
        .upsert({ user_id: owner.id, pinned_ids: [screenId] }, { onConflict: "user_id" });
      if (error) throw error;
    });

    await check("owner can upsert layout", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { error } = await ownerClient
        .from("screen_layouts")
        .upsert([{ user_id: owner.id, screen_id: screenId, x: 12, y: 8 }], { onConflict: "user_id,screen_id" });
      if (error) throw error;
    });

    await check("other users cannot read private screens", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { data, error } = await viewerClient.from("screens").select("id").eq("id", screenId);
      if (error && !["PGRST116", "42501"].includes(error.code ?? "")) throw error;
      if ((data ?? []).length > 0) throw new Error("Unexpected read access");
    });

    await check("other users cannot update screens", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { error } = await viewerClient.from("screens").update({ name: "hijack" }).eq("id", screenId);
      if (!error) throw new Error("Update should fail under RLS");
    });

    await check("other users cannot read pins/layouts", async () => {
      if (!screenId) throw new Error("missing screen id");
      const pins = await viewerClient.from("user_pins").select("pinned_ids").eq("user_id", owner.id);
      if ((pins.data ?? []).length > 0 && !pins.error) throw new Error("Pins leaked across users");
      const layouts = await viewerClient.from("screen_layouts").select("screen_id").eq("screen_id", screenId);
      if ((layouts.data ?? []).length > 0 && !layouts.error) throw new Error("Layouts leaked across users");
    });

    await check("public screens readable via share token", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { error } = await ownerClient
        .from("screens")
        .update({ is_public: true, share_token: shareToken })
        .eq("id", screenId);
      if (error) throw error;

      const { data, error: readError } = await viewerClient
        .rpc("get_public_screen_by_token", { token: shareToken });
      if (readError) throw readError;
      const normalized = Array.isArray(data) ? data[0] : data;
      if (!normalized?.id) throw new Error("Share token not readable by others");
    });

    await check("rpc get_public_screen_by_token omits user_id", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { data, error } = await viewerClient.rpc("get_public_screen_by_token", { token: shareToken });
      if (error) throw error;
      const row = normalizeRpcRow(data);
      if (!row?.id) throw new Error("RPC did not return a screen");
      if ("user_id" in row) throw new Error("RPC response should not include user_id");
    });

    await check("rpc blocks non-matching token", async () => {
      const { data, error } = await viewerClient.rpc("get_public_screen_by_token", { token: `${shareToken}_wrong` });
      if (error) throw error;
      const row = normalizeRpcRow(data);
      if (row?.id) throw new Error("RPC should not return any row for a non-matching token");
    });

    await check("rpc blocks non-public row even with token", async () => {
      const { data: inserted, error: insertError } = await ownerClient
        .from("screens")
        .insert([
          {
            user_id: owner.id,
            name: "Smoke Private Token Screen",
            message_content: "private",
            keyboard: [],
            is_public: false,
            share_token: privateShareToken,
          },
        ])
        .select("id")
        .single();
      if (insertError) throw insertError;
      if (!inserted?.id) throw new Error("Failed to create private screen");
      privateScreenId = inserted.id;

      const { data, error } = await viewerClient.rpc("get_public_screen_by_token", { token: privateShareToken });
      if (error) throw error;
      const row = normalizeRpcRow(data);
      if (row?.id) throw new Error("RPC should not return non-public rows even if token matches");
    });

    await check("public screens not readable via direct select", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { data, error } = await viewerClient
        .from("screens")
        .select("id")
        .eq("share_token", shareToken)
        .eq("is_public", true);
      if (error && !["PGRST116", "42501"].includes(error.code ?? "")) throw error;
      if ((data ?? []).length > 0) throw new Error("Public screens should not be readable via table select");
    });

    await check("anon cannot directly select screens table", async () => {
      const { data, error } = await anon.from("screens").select("id").limit(1);
      if (!error) {
        throw new Error(`Anon should not be able to SELECT screens directly (got ${(data ?? []).length} rows)`);
      }
    });

    await check("public screens reject sensitive content", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { error } = await ownerClient
        .from("screens")
        .update({ message_content: "Wallet: TXyne3zFjt2n9zye9oSXiZcmGExYaM1jxv" })
        .eq("id", screenId);
      if (!error) throw new Error("Sensitive content should block public screens");
    });

    await check("public screens reject sensitive data inside keyboard JSON", async () => {
      if (!screenId) throw new Error("missing screen id");
      const keyboardWithWallet = [
        [
          {
            text: "Donate TXyne3zFjt2n9zye9oSXiZcmGExYaM1jxv",
            url: "https://example.com/pay?to=TXyne3zFjt2n9zye9oSXiZcmGExYaM1jxv",
          },
        ],
      ];
      const { error } = await ownerClient.from("screens").update({ keyboard: keyboardWithWallet }).eq("id", screenId);
      if (!error) throw new Error("Sensitive content should be blocked when present in keyboard JSON");
    });

    await check("public screens still blocked for update by others", async () => {
      if (!screenId) throw new Error("missing screen id");
      const { error } = await viewerClient.from("screens").update({ name: "bad" }).eq("id", screenId);
      if (!error) throw new Error("Update should be blocked even when public");
    });

    if (results.length > 0) {
      throw new Error(`${results.length} RLS checks failed`);
    }

    console.log("🎉 RLS smoke passed");
  } finally {
    await cleanup({ ownerId: owner?.id, viewerId: viewer?.id, screenId, privateScreenId });
  }
}

const cleanup = async ({ ownerId, viewerId, screenId, privateScreenId }) => {
  try {
    const screenIds = [screenId, privateScreenId].filter(Boolean);
    if (screenIds.length > 0) {
      await admin.from("screen_layouts").delete().in("screen_id", screenIds);
      await admin.from("screens").delete().in("id", screenIds);
    }
    if (ownerId) await admin.from("user_pins").delete().eq("user_id", ownerId);
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    if (viewerId) await admin.auth.admin.deleteUser(viewerId);
  } catch (e) {
    console.warn("Cleanup warning:", e instanceof Error ? e.message : e);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
