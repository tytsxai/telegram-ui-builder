import { test, expect } from "@playwright/test";

test("auth page loads and shows login form", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: /登录|log in/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});
