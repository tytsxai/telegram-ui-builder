import { test, expect } from "@playwright/test";
import type { Screen } from "@/types/telegram";

const storageKey = "sb-imblnkgnerlewrhdzqis-auth-token";
const user = { id: "user-e2e", email: "e2e@example.com", role: "authenticated", aud: "authenticated" };
const session = {
  access_token: "e2e-access-token",
  refresh_token: "e2e-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
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

test("create -> edit -> save template flow", async ({ page }) => {
  const screens: Screen[] = [];

  await page.addInitScript(
    ({ key, sessionData, userData }) => {
      const payload = { ...sessionData, user: userData };
      window.localStorage.setItem(key, JSON.stringify(payload));
      window.localStorage.setItem(`${key}-user`, JSON.stringify({ user: userData }));
    },
    { key: storageKey, sessionData: session, userData: user },
  );

  await page.route("**/auth/v1/user", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 200, headers: corsHeaders(), body: "" });
    }
    return route.fulfill({ status: 200, headers: jsonHeaders(), body: JSON.stringify({ user }) });
  });

  await page.route("**/auth/v1/token**", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 200, headers: corsHeaders(), body: "" });
    }
    return route.fulfill({
      status: 200,
      headers: jsonHeaders(),
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: "bearer",
        expires_in: 3600,
      }),
    });
  });

  await page.route("**/rest/v1/user_pins**", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 200, headers: corsHeaders(), body: "" });
    }
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, headers: jsonHeaders(), body: JSON.stringify({ pinned_ids: [] }) });
    }
    return route.fulfill({ status: 200, headers: jsonHeaders(), body: route.request().postData() ?? "{}" });
  });

  await page.route("**/rest/v1/screens**", (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") {
      return route.fulfill({ status: 200, headers: corsHeaders(), body: "" });
    }

    if (method === "GET") {
      return route.fulfill({ status: 200, headers: jsonHeaders(), body: JSON.stringify(screens) });
    }

    const payload = route.request().postDataJSON?.() ?? JSON.parse(route.request().postData() ?? "{}");

    if (method === "POST") {
      const created = {
        id: `screen-${screens.length + 1}`,
        ...payload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      screens.push(created);
      return route.fulfill({ status: 201, headers: jsonHeaders(), body: JSON.stringify(created) });
    }

    if (method === "PATCH") {
      const url = new URL(route.request().url());
      const idParam = url.searchParams.get("id");
      const targetId = idParam ? idParam.replace("eq.", "") : payload.id;
      const idx = screens.findIndex((s) => s.id === targetId);
      if (idx !== -1) {
        screens[idx] = { ...screens[idx], ...payload };
        return route.fulfill({ status: 200, headers: jsonHeaders(), body: JSON.stringify(screens[idx]) });
      }
    }

    return route.fulfill({ status: 404, headers: jsonHeaders(), body: "{}" });
  });

  await page.goto("/");

  await expect(page.getByText(/Telegram Bot/i)).toBeVisible();

  await page.getByPlaceholder("输入名称...").fill("E2E Flow Template");

  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.fill("Hello from E2E flow");

  const keyboardButton = page.locator(".bg-telegram-button").first();
  await keyboardButton.dblclick();
  const textInput = page.locator('input[type="text"]').first();
  await textInput.fill("E2E Button");
  await textInput.press("Enter");

  await page.getByRole("button", { name: "保存新模版" }).click();

  await expect(page.getByText(/Screen saved/i)).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => screens.length).toBe(1);

  await editor.click();
  await editor.fill("Updated content for E2E");
  await page.getByRole("button", { name: /保存修改/ }).click();

  await expect.poll(() => screens[0]?.message_content ?? "").toContain("Updated content for E2E");
});
