import { test, expect } from "@playwright/test";
import type { Screen } from "@/types/telegram";

test.describe("Drag-sort, media, parse mode, and codegen flow", () => {
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

  test.beforeEach(async ({ page }) => {
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
  });

  test("drag buttons, change parse mode/media, save and see codegen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Telegram Bot/i)).toBeVisible();

    // 输入名称并写入内容
    await page.getByPlaceholder("输入名称...").fill("Drag Test");
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await editor.fill("Hello **bold**");

    // 切换 Parse Mode
    await page.getByText("HTML", { exact: true }).click();
    await page.getByRole("option", { name: "MarkdownV2" }).click();

    // 设置媒体类型与 URL
    await page.getByLabel("消息类型").selectOption("photo");
    await page.getByLabel("媒体 URL").fill("https://example.com/pic.jpg");

    // 拖拽第一个按钮到第二位（dnd-kit + data-testid via text)
    const firstBtn = page.getByRole("button", { name: "Button 1" }).first();
    const secondBtn = page.getByRole("button", { name: "Button 2" }).first();
    await firstBtn.dragTo(secondBtn);

    // 保存新模板
    await page.getByRole("button", { name: "保存新模版" }).click();
    await expect(page.getByText(/Screen saved/i)).toBeVisible({ timeout: 5000 });

    // 打开代码生成区域并验证有内容
    await page.getByText("代码生成").scrollIntoViewIfNeeded();
    await expect(page.getByText("代码生成")).toBeVisible();
    await expect(page.getByText("python-telegram-bot")).toBeVisible();
    const codeArea = page.getByPlaceholder("生成的代码将显示在此");
    await expect(codeArea).not.toBeEmpty();
  });
});
