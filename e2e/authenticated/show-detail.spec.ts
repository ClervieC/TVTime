import { test, expect } from "@playwright/test";

// TVmaze show id 1 ("Under the Dome") — stable, already relied on elsewhere
// (see e2e/authenticated/admin.spec.ts).
const SHOW_ID = 1;
const SHOW_NAME = "Under the Dome";

test("show detail page renders title, tabs, and cast", async ({ page }) => {
  await page.goto(`/show/${SHOW_ID}`);

  // Title comes from a real TVmaze fetch (no cache warm on a fresh test
  // context) — worth a longer timeout than the default 5s since this is the
  // very first network round trip on this page.
  await expect(page.getByText(SHOW_NAME).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Info", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Episodes", { exact: true })).toBeVisible({ timeout: 20_000 });
  // Cast/Comments live under the Info tab — Episodes is the default tab
  // (see app/show/[id].tsx's useState) so they aren't visible until it's
  // selected.
  await page.getByText("Info", { exact: true }).first().click();
  // Cast only renders once TVmaze's cast call resolves — worth a longer
  // timeout than the default since it's a real network round trip.
  await expect(page.getByText("Cast", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("switching to the Episodes tab shows seasons", async ({ page }) => {
  await page.goto(`/show/${SHOW_ID}`);
  await page.getByText("Episodes", { exact: true }).click();
  await expect(page.getByText("Season 1", { exact: true })).toBeVisible({ timeout: 15_000 });
});

// Posts a real comment on the show (exercising ShowDetail's CommentsSection
// -> lib/comments.ts -> Supabase round trip), confirms it renders, then
// deletes it so this dedicated test account's comment history stays clean
// across repeated runs.
test("can post and delete a comment on a show", async ({ page }) => {
  const uniqueComment = `e2e show comment ${Date.now()}`;

  await page.goto(`/show/${SHOW_ID}`);
  await page.getByText("Info", { exact: true }).first().click();
  await expect(page.getByText("Comments", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder("Add a comment...").fill(uniqueComment);
  await page.getByLabel("Send comment").click();
  await expect(page.getByText(uniqueComment)).toBeVisible({ timeout: 15_000 });

  // The comment body Text and its row's delete button are siblings under
  // the same commentRow View (see components/CommentsSection.tsx) — going
  // up one level from the body text lands directly on that row.
  const commentRow = page.getByText(uniqueComment, { exact: true }).locator("xpath=..");
  await commentRow.getByLabel("Delete comment").click();
  await expect(page.getByText(uniqueComment)).not.toBeVisible({ timeout: 10_000 });
});
