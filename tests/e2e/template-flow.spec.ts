import { test, expect } from "@playwright/test";
import { seedAuthSession, setupSupabaseMock, type SupabaseMockState } from "../fixtures/supabaseMock";

let supabaseState: SupabaseMockState;

test.beforeEach(async ({ page }) => {
  const { state } = await setupSupabaseMock(page);
  supabaseState = state;
  await seedAuthSession(page);
});

test("create -> edit -> save template flow", async ({ page }) => {
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
  await expect.poll(() => supabaseState.screens.length).toBe(1);

  await editor.click();
  await editor.fill("Updated content for E2E");
  await page.getByRole("button", { name: /保存修改/ }).click();

  await expect.poll(() => supabaseState.screens[0]?.message_content ?? "").toContain("Updated content for E2E");
});
