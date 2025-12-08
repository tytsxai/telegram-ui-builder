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

async function main() {
  let owner = null;
  let viewer = null;
  let screenId = "";
  let shareToken = `smoke_${Date.now()}`;

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
        .from("screens")
        .select("id,share_token,is_public")
        .eq("share_token", shareToken)
        .eq("is_public", true)
        .maybeSingle();
      if (readError) throw readError;
      if (!data?.id) throw new Error("Share token not readable by others");
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
    await cleanup({ ownerId: owner?.id, viewerId: viewer?.id, screenId });
  }
}

const cleanup = async ({ ownerId, viewerId, screenId }) => {
  try {
    if (screenId) {
      await admin.from("screen_layouts").delete().eq("screen_id", screenId);
      await admin.from("user_pins").delete().eq("user_id", ownerId);
      await admin.from("screens").delete().eq("id", screenId);
    }
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
