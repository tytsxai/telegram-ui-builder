import fs from "fs/promises";
import { test, expect } from "@playwright/test";
import { mockUser, seedAuthSession, setupSupabaseMock, storageKey } from "../fixtures/supabaseMock";

test.use({ acceptDownloads: true });

test("login -> create/link -> export/import -> share -> offline queue replay", async ({ page }) => {
  await seedAuthSession(page);
  const { state } = await setupSupabaseMock(page);

  await page.goto("/");
  await page.getByRole("button", { name: /跳过引导/ }).click({ timeout: 6000 }).catch(() => { });
  await expect(page.locator('[data-testid="inline-keyboard"]')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => page.evaluate((key) => !!localStorage.getItem(key), storageKey)).toBeTruthy();

  const editor = page.locator('[contenteditable="true"]').first();

  // Create entry screen
  await page.getByPlaceholder("输入名称...").fill("Entry Screen");
  await editor.click();
  await editor.fill("Entry message for sharing");
  await page.getByRole("button", { name: "保存新模版" }).click();
  // default screen is pre-seeded, so after first save there should be 2
  await expect.poll(() => state.screens.length, { timeout: 10_000 }).toBe(2);
  const entryScreen = state.screens.find((s) => s.name === "Entry Screen");
  await expect(entryScreen?.name ?? "").toBe("Entry Screen");
  const entryId = entryScreen!.id;

  // Create detail screen
  await page.getByRole("button", { name: "新建模版" }).click();
  await page.getByPlaceholder("输入名称...").fill("Detail Screen");
  await editor.click();
  await editor.fill("Details to be linked");
  await page.getByRole("button", { name: "保存新模版" }).click();
  await expect.poll(() => state.screens.length, { timeout: 10_000 }).toBe(3);
  const detailScreen = state.screens.find((s) => s.name === "Detail Screen");
  await expect(detailScreen?.name ?? "").toBe("Detail Screen");
  const detailId = detailScreen!.id;

  // Switch back to entry screen via template list selector
  const templateSelect = page.getByTestId("template-select-trigger");
  await templateSelect.click();
  await page.getByRole("option", { name: "Entry Screen" }).waitFor();
  await page.getByRole("option", { name: "Entry Screen" }).click();

  // Link first button to the detail screen
  const jsonPreview = page.getByPlaceholder("JSON output...");
  const currentJson = await jsonPreview.inputValue();
  const parsed = JSON.parse(currentJson);
  parsed.reply_markup.inline_keyboard[0][0].linked_screen_id = detailId;
  await jsonPreview.fill(JSON.stringify(parsed));
  await page.getByRole("button", { name: "应用修改" }).click();
  await expect(page.locator('[title="已配置跳转模版"]').first()).toBeVisible();

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
