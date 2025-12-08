import { test, expect } from "@playwright/test";
import { setupSupabaseMock } from "../fixtures/supabaseMock";

test.beforeEach(async ({ page }) => {
  await setupSupabaseMock(page);
});

test("auth page loads and shows login form", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: /登录|log in/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder(/email/i)).toBeVisible();
  await expect(page.getByPlaceholder(/password/i)).toBeVisible();
});
