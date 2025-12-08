import fs from "fs/promises";
import { test, expect } from "@playwright/test";
import { mockUser, setupSupabaseMock, storageKey } from "../fixtures/supabaseMock";

test.use({ acceptDownloads: true });

test("login -> create/link -> export/import -> share -> offline queue replay", async ({ page }) => {
  const { state } = await setupSupabaseMock(page);

  // Login
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: /log in/i })).toBeVisible();
  await page.getByPlaceholder("Email").fill(mockUser.email);
  await page.getByPlaceholder("Password").fill("password123");
  await page.getByRole("button", { name: /log in/i }).click();

  await page.waitForURL("**/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Telegram Bot/i)).toBeVisible();
  await expect.poll(() => page.evaluate((key) => !!localStorage.getItem(key), storageKey)).toBeTruthy();

  const editor = page.locator('[contenteditable="true"]').first();

  // Create entry screen
  await page.getByPlaceholder("输入名称...").fill("Entry Screen");
  await editor.click();
  await editor.fill("Entry message for sharing");
  await page.getByRole("button", { name: "保存新模版" }).click();
  await expect(page.getByText(/Screen saved/i)).toBeVisible({ timeout: 5000 });
  await expect.poll(() => state.screens.length).toBe(1);
  const entryId = state.screens[0].id;

  // Create detail screen
  await page.getByRole("button", { name: "新建模版" }).click();
  await page.getByPlaceholder("输入名称...").fill("Detail Screen");
  await editor.click();
  await editor.fill("Details to be linked");
  await page.getByRole("button", { name: "保存新模版" }).click();
  await expect(page.getByText(/Screen saved/i)).toBeVisible({ timeout: 5000 });
  await expect.poll(() => state.screens.length).toBe(2);
  const detailId = state.screens[1].id;

  // Switch back to entry screen via template list selector
  const templateSelect = page.locator('div:has(>h3:has-text("模版列表"))').getByRole("combobox");
  await templateSelect.click();
  await page.getByRole("option", { name: "Entry Screen" }).click();

  // Link first button to the detail screen
  const firstKeyboardButton = page.getByRole("button", { name: "Button 1" }).first();
  await firstKeyboardButton.hover();
  const editButton = page.getByRole("button", { name: "Edit button" }).first();
  await expect(editButton).toBeVisible();
  await editButton.click();
  await page.getByRole("tab", { name: "链接模版" }).click();
  await page.getByText("选择要链接的模版").click();
  await page.getByRole("option", { name: "Detail Screen" }).click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator('[title="已配置跳转模版"]').first()).toBeVisible();

  // Mark entry and export flow JSON
  await page.getByRole("button", { name: "设为入口" }).click();
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
  await expect(page.getByText("Imported via E2E")).toBeVisible();

  // Share entry screen and capture link
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4173" });
  await page.getByRole("button", { name: "生成/复制入口链接" }).click();
  const shareUrl = await page.evaluate(async () => navigator.clipboard.readText());
  expect(shareUrl).toContain("/share/");
  const sharedEntry = state.screens.find((s) => s.id === entryId);
  expect(sharedEntry?.share_token).toBeTruthy();

  // Open share page and copy template into account
  const sharePage = await page.context().newPage();
  await sharePage.goto(shareUrl);
  await expect(sharePage.getByText("Entry Screen")).toBeVisible({ timeout: 10_000 });
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
  await expect(page.getByText(/离线模式/)).toBeVisible();
  const pendingAlert = page.getByText(/有未同步的保存请求/);
  await pendingAlert.scrollIntoViewIfNeeded();
  await expect(pendingAlert).toBeVisible();

  await page.context().setOffline(false);
  await expect(page.getByText("离线队列已同步")).toBeVisible({ timeout: 10_000 });
  await expect(pendingAlert).toBeHidden({ timeout: 5000 });
  await expect.poll(() => state.screens.find((s) => s.id === entryId)?.message_content).toBe(offlineMessage);
});
