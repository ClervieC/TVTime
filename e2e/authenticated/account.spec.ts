import { test, expect } from "@playwright/test";

// Settings/Legal/Account moved out of Profile into their own screen behind
// the gear icon (see app/settings.tsx) — go straight there.
test.beforeEach(async ({ page }) => {
  await page.goto("/settings");
});

test("shows the Account settings section", async ({ page }) => {
  await expect(page.getByText("Account", { exact: true })).toBeVisible();
  await expect(page.getByText("Change password", { exact: true })).toBeVisible();
  await expect(page.getByText("Download my data", { exact: true })).toBeVisible();
  await expect(page.getByText("Delete account", { exact: true })).toBeVisible();
});

// Opens the change-password sheet and checks its validation — doesn't
// actually submit a new password, which would break this account's login
// for every other test run.
test("change password sheet validates a too-short password", async ({ page }) => {
  await page.getByText("Change password", { exact: true }).click();
  await expect(page.getByPlaceholder("New password")).toBeVisible();
  await page.getByPlaceholder("New password").fill("abc");
  await page.getByText("Update password", { exact: true }).click();
  await expect(page.getByText("Password must be at least 6 characters.")).toBeVisible();
});

test("Admin row is visible for this admin test account", async ({ page }) => {
  await expect(page.getByText("Admin", { exact: true })).toBeVisible();
});
