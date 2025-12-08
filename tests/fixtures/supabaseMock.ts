import type { Page, Route } from "@playwright/test";
import type { Screen } from "@/types/telegram";

export type SupabaseMockState = {
  screens: Screen[];
  userPins: string[];
  layouts: Array<{ screen_id: string; user_id?: string | null; x?: number; y?: number }>;
};

export const storageKey = "sb-imblnkgnerlewrhdzqis-auth-token";
export const mockUser = { id: "user-e2e", email: "e2e@example.com", role: "authenticated", aud: "authenticated" };
export const mockSession = {
  access_token: "e2e-access-token",
  refresh_token: "e2e-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: mockUser,
};

const corsHeaders = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
});

const jsonHeaders = () => ({
  ...corsHeaders(),
  "content-type": "application/json",
});

const parseBody = (route: Route) => {
  try {
    const json = route.request().postDataJSON?.();
    if (json && typeof json === "object") return json as Record<string, unknown>;
    const raw = route.request().postData();
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
};

const respond = async (route: Route, status: number, body: unknown, headers = jsonHeaders()) =>
  route.fulfill({
    status,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export const seedAuthSession = async (page: Page) => {
  await page.addInitScript(
    ({ key, sessionData, userData }) => {
      const payload = { ...sessionData, user: userData };
      window.localStorage.setItem(key, JSON.stringify(payload));
      window.localStorage.setItem(`${key}-user`, JSON.stringify({ user: userData }));
    },
    { key: storageKey, sessionData: mockSession, userData: mockUser },
  );
};

export const setupSupabaseMock = async (page: Page, initialState?: Partial<SupabaseMockState>) => {
  const state: SupabaseMockState = {
    screens: initialState?.screens ?? [],
    userPins: initialState?.userPins ?? [],
    layouts: initialState?.layouts ?? [],
  };
  const ctx = page.context();

  ctx.route("**/auth/v1/**", async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") {
      return respond(route, 200, "", corsHeaders());
    }

    const url = new URL(route.request().url());
    if (url.pathname.includes("/token")) {
      return respond(route, 200, { ...mockSession, user: mockUser });
    }
    if (url.pathname.includes("/user")) {
      return respond(route, 200, { user: mockUser });
    }
    if (url.pathname.includes("/logout")) {
      return respond(route, 200, {});
    }
    return respond(route, 200, {});
  });

  ctx.route("**/rest/v1/user_pins**", async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") {
      return respond(route, 200, "", corsHeaders());
    }
    if (method === "GET") {
      return respond(route, 200, { pinned_ids: state.userPins });
    }
    const body = parseBody(route);
    const nextPins = (body.pinned_ids as string[]) ?? [];
    state.userPins = nextPins;
    return respond(route, 200, { pinned_ids: nextPins });
  });

  ctx.route("**/rest/v1/screen_layouts**", async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") {
      return respond(route, 200, "", corsHeaders());
    }
    if (method === "GET") {
      return respond(route, 200, state.layouts);
    }
    const body = parseBody(route);
    const payloads = Array.isArray(body) ? body : [body];
    for (const item of payloads) {
      if (!item || typeof item !== "object") continue;
      const screenId = (item as { screen_id?: string }).screen_id;
      if (!screenId) continue;
      const existingIdx = state.layouts.findIndex((l) => l.screen_id === screenId);
      const updated = {
        screen_id: screenId,
        user_id: (item as { user_id?: string }).user_id ?? mockUser.id,
        x: (item as { x?: number }).x ?? 0,
        y: (item as { y?: number }).y ?? 0,
      };
      if (existingIdx === -1) {
        state.layouts.push(updated);
      } else {
        state.layouts[existingIdx] = updated;
      }
    }
    return respond(route, 200, payloads);
  });

  ctx.route("**/rest/v1/screens**", async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") {
      return respond(route, 200, "", corsHeaders());
    }

    const url = new URL(route.request().url());
    const eq = (value: string | null) => (value?.startsWith("eq.") ? value.slice(3) : value ?? undefined);

    if (method === "GET") {
      let result = [...state.screens];
      const userFilter = eq(url.searchParams.get("user_id"));
      const idFilter = eq(url.searchParams.get("id"));
      const tokenFilter = eq(url.searchParams.get("share_token"));
      const isPublicFilter = eq(url.searchParams.get("is_public"));

      if (userFilter) result = result.filter((s) => s.user_id === userFilter);
      if (idFilter) result = result.filter((s) => s.id === idFilter);
      if (tokenFilter) result = result.filter((s) => s.share_token === tokenFilter);
      if (isPublicFilter !== undefined) result = result.filter((s) => String(s.is_public ?? false) === isPublicFilter);

      const wantsSingle = !!tokenFilter || url.searchParams.get("limit") === "1" || url.searchParams.get("select")?.includes("share_token");
      return respond(route, 200, wantsSingle ? result[0] ?? null : result);
    }

    const body = parseBody(route);
    if (method === "POST") {
      const payloads = Array.isArray(body) ? body : [body];
      const createdScreens = payloads.map((payload, idx) => ({
        id: (payload as { id?: string }).id ?? `screen-${state.screens.length + idx + 1}`,
        name: (payload as { name?: string }).name ?? "Untitled",
        message_content: (payload as { message_content?: string }).message_content ?? "",
        keyboard: (payload as { keyboard?: Screen["keyboard"] }).keyboard ?? [],
        parse_mode: (payload as { parse_mode?: Screen["parse_mode"] }).parse_mode,
        message_type: (payload as { message_type?: Screen["message_type"] }).message_type,
        media_url: (payload as { media_url?: string | null }).media_url ?? null,
        share_token: (payload as { share_token?: string | null }).share_token ?? null,
        is_public: (payload as { is_public?: boolean | null }).is_public ?? false,
        created_at: (payload as { created_at?: string | null }).created_at ?? new Date().toISOString(),
        updated_at: (payload as { updated_at?: string | null }).updated_at ?? new Date().toISOString(),
        user_id: (payload as { user_id?: string | null }).user_id ?? mockUser.id,
      })) as Screen[];
      state.screens.push(...createdScreens);
      return respond(route, 201, payloads.length === 1 ? createdScreens[0] : createdScreens);
    }

    if (method === "PATCH") {
      const targetId = eq(url.searchParams.get("id")) ?? (body.id as string | undefined);
      const idx = targetId ? state.screens.findIndex((s) => s.id === targetId) : -1;
      if (idx === -1) {
        return respond(route, 404, { error: "not found" });
      }
      const updated: Screen = {
        ...state.screens[idx],
        ...body,
        id: state.screens[idx].id,
        updated_at: (body.updated_at as string | null | undefined) ?? new Date().toISOString(),
      };
      state.screens[idx] = updated;
      return respond(route, 200, updated);
    }

    if (method === "DELETE") {
      const idFilter = eq(url.searchParams.get("id"));
      if (idFilter) {
        state.screens = state.screens.filter((s) => s.id !== idFilter);
      } else {
        state.screens = [];
      }
      return respond(route, 200, {});
    }

    return respond(route, 200, {});
  });

  return { state, storageKey, mockSession, mockUser };
};
