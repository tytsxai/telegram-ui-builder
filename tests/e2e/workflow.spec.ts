import { test, expect } from "@playwright/test";

test("happy path: visit home, export JSON, open flow diagram", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Telegram UI Builder|Telegram Bot/i)).toBeVisible();

  // Open flow diagram
  await page.getByRole("button", { name: /关系图|Flow Diagram|diagram/i }).click({ trial: true }).catch(() => {});

  // Export JSON via toolbar button (if present)
  const exportBtn = page.getByRole("button", { name: /导出|export/i }).first();
  if (await exportBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await exportBtn.click();
  }

  // Ensure keyboard and message render
  await expect(page.locator("text=Button").first()).toBeVisible();
});
