import { test, expect } from "@playwright/test";
import { seedAuthSession, setupSupabaseMock, type SupabaseMockState } from "../fixtures/supabaseMock";

let supabaseState: SupabaseMockState;

test.beforeEach(async ({ page }) => {
  const { state } = await setupSupabaseMock(page);
  supabaseState = state;
  await seedAuthSession(page);
});

test.describe("Drag-sort, media, parse mode, and codegen flow", () => {
  test("drag buttons, change parse mode/media, save and see codegen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Telegram Bot/i)).toBeVisible();

    // 输入名称并写入内容
    await page.getByPlaceholder("输入名称...").fill("Drag Test");
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await editor.fill("Hello **bold**");

    // 切换 Parse Mode
    await page.getByLabel("Parse Mode").selectOption("MarkdownV2");

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
    const codeArea = page.getByPlaceholder("生成的代码将显示在此");
    await expect(codeArea).toContainText("InlineKeyboardButton");
    await expect(codeArea).not.toBeEmpty();
    await expect.poll(() => supabaseState.screens.length).toBeGreaterThanOrEqual(1);
  });
});
