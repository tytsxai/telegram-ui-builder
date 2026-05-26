import fs from "fs/promises";
import { test, expect } from "@playwright/test";
import type { Screen } from "@/types/telegram";
import { mockUser, seedAuthSession, setupSupabaseMock, storageKey } from "../fixtures/supabaseMock";

test.use({ acceptDownloads: true });

test("login -> create/link -> export/import -> share -> offline queue replay", async ({ page }) => {
  await seedAuthSession(page);
  const now = new Date().toISOString();
  const baseKeyboard = [
    {
      id: "row-1",
      buttons: [
        { id: "btn-1", text: "Button 1", callback_data: "btn_1_action" },
        { id: "btn-2", text: "Button 2", callback_data: "btn_2_action" },
      ],
    },
  ];
  const seededScreens: Screen[] = [
    {
      id: "entry-screen",
      name: "Entry Screen",
      message_content: "Entry message for sharing",
      keyboard: baseKeyboard,
      parse_mode: "HTML",
      message_type: "text",
      media_url: null,
      share_token: null,
      is_public: false,
      created_at: now,
      updated_at: now,
      user_id: mockUser.id,
    },
    {
      id: "detail-screen",
      name: "Detail Screen",
      message_content: "Details to be linked",
      keyboard: baseKeyboard,
      parse_mode: "HTML",
      message_type: "text",
      media_url: null,
      share_token: null,
      is_public: false,
      created_at: now,
      updated_at: now,
      user_id: mockUser.id,
    },
  ];
  const { state } = await setupSupabaseMock(page, { screens: seededScreens });

  await page.goto("/");
  await page.getByRole("button", { name: /跳过引导/ }).click({ timeout: 6000 }).catch(() => { });
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="inline-keyboard"]')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => page.evaluate((key) => !!localStorage.getItem(key), storageKey)).toBeTruthy();

  const editor = page.locator('[contenteditable="true"]').first();
  const entryId = "entry-screen";

  // Switch back to entry screen via template list selector
  const templateSelect = page.getByTestId("template-select-trigger");
  await templateSelect.click();
  await page.getByRole("option", { name: "Entry Screen" }).waitFor();
  await page.getByRole("option", { name: "Entry Screen" }).click();

  // Link first button to the detail screen through the same dialog operators use.
  const firstButtonWrapper = page.locator('[data-testid="inline-keyboard"] .group').first();
  await firstButtonWrapper.hover();
  await firstButtonWrapper.getByRole("button", { name: /Edit button/i }).first().click({ force: true });
  const dialog = page.getByRole("dialog", { name: "编辑按钮" });
  await dialog.getByRole("tab", { name: "链接模版" }).click();
  await dialog.getByText("选择要链接的模版").click();
  await page.getByRole("option", { name: "Detail Screen" }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.locator('[title="已配置跳转模版"]').first()).toHaveCount(1);

  // Mark entry and export flow JSON
  const entrySelect = page.getByTestId("entry-select-trigger");
  await entrySelect.click();
  await page.getByRole("option", { name: "Entry Screen" }).click();
  const setEntryButton = page.getByRole("button", { name: /设为入口|入口/ }).first();
  if (await setEntryButton.isVisible()) {
    await setEntryButton.click();
  }
  const [flowDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出流程" }).click(),
  ]);
  const flowPath = await flowDownload.path();
  const flowContent = flowPath ? await fs.readFile(flowPath, "utf-8") : "";
  if (flowContent) {
    const flow = JSON.parse(flowContent);
    expect(flow.entry_screen_id).toBe(entryId);
  }
  expect(flowDownload.suggestedFilename()).toContain("telegram-flow");

  // Import JSON to update content
  await page.getByRole("button", { name: "导入" }).click();
  const importPayload = { text: "Imported via E2E" };
  await page.getByLabel("粘贴 JSON 数据").fill(JSON.stringify(importPayload));
  await page.getByRole("button", { name: /^导入$/ }).click();
  await expect(page.locator('[contenteditable="true"]', { hasText: "Imported via E2E" }).first()).toBeVisible();

  // Share entry screen and capture link
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:8080" });
  await page.getByRole("button", { name: "生成/复制入口链接" }).click();
  await expect.poll(() => state.screens.find((s) => s.id === entryId)?.share_token ?? "").not.toBe("");
  const sharedEntry = state.screens.find((s) => s.id === entryId);
  const clipboardValue = await page.evaluate(async () => navigator.clipboard.readText());
  const shareUrl = clipboardValue || (sharedEntry?.share_token ? `${new URL(page.url()).origin}/share/${sharedEntry.share_token}` : "");
  expect(shareUrl).toContain("/share/");
  expect(sharedEntry?.share_token).toBeTruthy();

  // Open share page and copy template into account
  const sharePage = await page.context().newPage();
  await sharePage.goto(shareUrl);
  await expect(sharePage.getByRole("heading", { name: "Entry Screen" })).toBeVisible({ timeout: 10_000 });
  await sharePage.getByRole("button", { name: "复制并编辑" }).click();
  await sharePage.waitForURL("**/", { timeout: 10_000 });
  await expect.poll(() => state.screens.length).toBeGreaterThanOrEqual(3);

  // Offline queue update then replay
  const offlineMessage = "Offline queued update";
  await page.bringToFront();
  await editor.click();
  await editor.fill(offlineMessage);
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("⚠️ 离线模式")).toBeVisible();
  const pendingAlert = page.getByText(/有未同步的保存请求/);
  await pendingAlert.scrollIntoViewIfNeeded();
  await expect(pendingAlert).toBeVisible();

  await page.context().setOffline(false);
  await expect(page.getByText("离线队列已同步").first()).toBeVisible({ timeout: 10_000 });
  await expect(pendingAlert).toBeHidden({ timeout: 5000 });
  await expect.poll(() => state.screens.find((s) => s.id === entryId)?.message_content).toBe(offlineMessage);
});
