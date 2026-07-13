import { test, expect } from "@playwright/test";

// causer.clervie@gmail.com (the test account e2e/auth.setup.ts logs in
// with) has profiles.is_admin = true specifically so this can be tested end
// to end — see supabase/schema.sql's "Admins view all reports" policy.
test("admin panel is reachable from Settings and shows the moderation console", async ({ page }) => {
  // Settings/Legal/Account (including the admin row) moved out of Profile
  // into their own screen behind the gear icon (see app/settings.tsx).
  await page.goto("/settings");
  await page.getByText("Admin", { exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);

  // Not the "Not authorized" fallback (see app/admin/index.tsx) — proves
  // the is_admin check actually passed for this account instead of just
  // showing the screen shell. "Admin" matches twice once here (the Profile
  // row + this screen's own header) since expo-router's native-stack-on-web
  // keeps the previous screen mounted underneath — .last() is the newly
  // active one.
  await expect(page.getByText("Not authorized")).not.toBeVisible();
  await expect(page.getByText("Admin", { exact: true }).last()).toBeVisible();
});

test("admin panel has Open/Resolved/Dismissed report tabs", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText("Open", { exact: true })).toBeVisible();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(page.getByText("Dismissed", { exact: true })).toBeVisible();
});

test("switching report status tabs loads without error", async ({ page }) => {
  await page.goto("/admin");
  await page.getByText("Resolved", { exact: true }).click();
  // Either the empty state or at least one report card renders — either
  // way, no error screen and the tab switch itself didn't throw. .first()
  // since a suite run accumulates multiple resolved reports over time (each
  // with its own "Reported by" line), and only presence is being checked
  // here, not a specific one.
  await expect(
    page.getByText("No reports here.").or(page.locator("text=/Reported by/").first())
  ).toBeVisible({ timeout: 10_000 });
});

// End-to-end: file a real report as a normal user action (reporting a show,
// the simplest target — no comment/user id needed), then confirm it shows
// up in the admin queue. Exercises the full path: ReportModal -> reports
// table insert -> RLS -> admin SELECT -> UI.
test("a submitted report appears in the admin Open queue", async ({ page }) => {
  // Slower than the rest of the suite (navigate, submit, navigate again,
  // clean up) and the most likely to feel real-world network/DB latency —
  // give it real headroom instead of the 30s default, especially under
  // this suite's full parallelism where every worker is competing for CPU.
  test.setTimeout(60_000);
  const uniqueReason = `e2e test report ${Date.now()}`;

  // The success confirmation is a real window.alert() on web (see
  // lib/alert.ts) — a native browser dialog, not DOM content, so it has to
  // be caught via Playwright's dialog event rather than getByText. Without
  // this handler Playwright auto-dismisses it anyway (harmless), but
  // asserting on its text is what actually proves the app called it.
  const dialogText = new Promise<string>((resolve) => {
    page.once("dialog", (dialog) => {
      resolve(dialog.message());
      dialog.accept();
    });
  });

  await page.goto("/show/1"); // TVmaze show id 1 (Under the Dome) — stable, always exists
  // Icon-only button — no visible text, only an accessibilityLabel (see the
  // a11y pass in app/show/[id].tsx).
  await page.getByLabel("More options").click();
  await page.getByText("Report show", { exact: true }).click();
  await page.getByPlaceholder("What's the issue?").fill(uniqueReason);
  await page.getByText("Submit report", { exact: true }).click();
  expect(await dialogText).toContain("Report submitted");

  await page.goto("/admin");
  await expect(page.getByText(uniqueReason)).toBeVisible({ timeout: 20_000 });

  // Cleanup — resolves the report this test just filed so it doesn't sit
  // in the real Open queue after the run. The smallest element containing
  // both the reason text and a "Resolve" button is this report's own card
  // (see app/admin/index.tsx's ReportCard) — .last() picks that innermost
  // match over the larger containers (the list, the screen) that also
  // technically contain both texts.
  const card = page
    .locator("div")
    .filter({ hasText: uniqueReason })
    .filter({ hasText: "Resolve" })
    .last();
  await card.getByText("Resolve", { exact: true }).click();
  await expect(page.getByText(uniqueReason)).not.toBeVisible({ timeout: 20_000 });
});
