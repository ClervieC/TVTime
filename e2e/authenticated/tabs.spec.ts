import { test, expect } from "@playwright/test";

// Runs already logged in (see e2e/auth.setup.ts + playwright.config.ts's
// "authenticated" project) — this just proves the four main tabs render
// their own core content, not full feature coverage of each screen.
test("Shows tab is the default landing screen", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$|\/index$/);
  // "My list"/"Upcoming" sub-tabs are the Shows screen's own signature —
  // present regardless of whether this account has any tracked shows yet.
  await expect(page.getByText("My list", { exact: true })).toBeVisible();
  await expect(page.getByText("Upcoming", { exact: true })).toBeVisible();
});

test("navigates to the Movies tab", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Movies", { exact: true }).click();
  await expect(page).toHaveURL(/\/movies$/);
});

test("navigates to the Explore tab and its categories load", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Explore", { exact: true }).click();
  await expect(page).toHaveURL(/\/explore$/);
  // Explore's discover categories come from TMDB (see app/(tabs)/explore.tsx)
  // — asserting at least one category title shows real data made it through,
  // not just an empty shell.
  await expect(page.locator("text=/Popular|Top Rated|Now Playing|Upcoming/").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("navigates to the Profile tab and shows account info", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Profile", { exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText("Statistics", { exact: true })).toBeVisible();
  // Settings/Legal/Account moved to their own screen behind this gear icon
  // (see app/settings.tsx) — Profile itself no longer has a "Settings" label.
  await expect(page.getByLabel("Settings", { exact: true })).toBeVisible();
});
