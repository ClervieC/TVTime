import { test, expect } from "@playwright/test";

// Stress/edge-case coverage — not the "does the golden path work" tests
// elsewhere in this suite, but "does the app survive input it wasn't
// specifically designed for". A crash or a stuck spinner here is a real
// finding even if none of these are realistic day-to-day usage.

test("navigating to a non-existent show id shows the error state, not a stuck spinner", async ({ page }) => {
  // TVmaze ids are sequential and finite — this one is astronomically
  // unlikely to ever exist. getShow() rejects for it, which app/show/[id].tsx
  // now catches into a dedicated DetailErrorState (see
  // components/DetailErrorState.tsx) instead of sitting on its loading
  // spinner forever with no way back.
  await page.goto("/show/999999999");
  await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Back to Shows", { exact: true })).toBeVisible();

  // This is the ErrorBoundary's own ("Try again") fallback title too, so
  // confirming it's *this* screen and not a render-time crash matters —
  // the back button must actually work, not just render.
  await page.getByText("Back to Shows", { exact: true }).click();
  await expect(page).toHaveURL(/\/$|\/index$/);
  await expect(page.getByText("My list", { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("navigating to a non-existent movie id shows the error state, not a stuck spinner", async ({ page }) => {
  // No matching user_movies row for this id — fetchUserMovie() resolves
  // null (see lib/userMovies.ts), which app/movie/[id].tsx now treats the
  // same as a thrown error rather than looping on <MovieDetailLoading />.
  await page.goto("/movie/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Back to Shows", { exact: true })).toBeVisible();
});

test("navigating to a non-existent tmdb movie id doesn't crash the app", async ({ page }) => {
  // Unlike app/movie/[id].tsx above, the TMDB-browsing route already had its
  // own graceful tmdbNotFound handling before this session's error-state
  // work — kept as a plain non-crash check since it renders inline, not via
  // DetailErrorState.
  await page.goto("/movie/tmdb/999999999");
  await page.waitForTimeout(3000);
  await expect(page.getByText("Something went wrong")).not.toBeVisible();
});

test("search handles special characters, emoji, and very long input without crashing", async ({ page }) => {
  await page.goto("/explore");
  const input = page.getByPlaceholder("Search for a show or movie");

  for (const query of [
    "'; DROP TABLE shows; --",
    "<script>alert(1)</script>",
    "🎬🍿📺".repeat(5),
    "a".repeat(500),
    "   ",
    "日本語のテスト",
  ]) {
    await input.fill(query);
    await page.waitForTimeout(500);
    await expect(page.getByText("Something went wrong")).not.toBeVisible();
  }
  await input.fill("");
});

test("rapid repeated taps on a watched toggle don't break state", async ({ page }) => {
  await page.goto("/movie/tmdb/13"); // Forrest Gump — distinct from the movie-detail.spec.ts title
  await expect(page.getByLabel("Mark as watched").or(page.getByLabel("Mark as not watched"))).toBeVisible({
    timeout: 15_000,
  });

  // Whatever state it starts in, toggle it an odd number of times fast —
  // the label itself is the assertion: it must always be exactly one of
  // the two valid states, never both/neither (e.g. from a race between two
  // in-flight toggle mutations).
  const startedWatched = await page.getByLabel("Mark as not watched").isVisible().catch(() => false);
  for (let i = 0; i < 5; i++) {
    const toggle = page.getByLabel("Mark as watched").or(page.getByLabel("Mark as not watched"));
    await toggle.click();
    await page.waitForTimeout(300);
  }
  // 5 toggles (odd) from the starting state lands on the opposite state.
  if (startedWatched) {
    await expect(page.getByLabel("Mark as watched")).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(page.getByLabel("Mark as not watched")).toBeVisible({ timeout: 10_000 });
    // Cleanup — leave it unwatched for repeat runs.
    await page.getByLabel("Mark as not watched").click();
    await expect(page.getByLabel("Mark as watched")).toBeVisible({ timeout: 10_000 });
  }
});

test("submitting an empty or whitespace-only comment is a no-op", async ({ page }) => {
  await page.goto("/show/1");
  await page.getByText("Info", { exact: true }).first().click();
  await expect(page.getByText("Comments", { exact: true })).toBeVisible({ timeout: 15_000 });

  const input = page.getByPlaceholder("Add a comment...");
  const sendBtn = page.getByLabel("Send comment");
  await input.fill("   ");
  // The send button is disabled for blank input (see
  // components/CommentsSection.tsx's !text.trim() check) — clicking it
  // anyway must not post anything.
  await sendBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1000);
  await expect(page.getByText("Something went wrong")).not.toBeVisible();
});

test("a very long comment posts and displays without crashing, then cleans up", async ({ page }) => {
  test.setTimeout(30_000);
  const marker = `e2e-long-${Date.now()}`;
  const longComment = `${marker} ${"stress test ".repeat(150)}`.trim(); // ~1800 chars

  await page.goto("/show/1");
  await page.getByText("Info", { exact: true }).first().click();
  await expect(page.getByText("Comments", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder("Add a comment...").fill(longComment);
  await page.getByLabel("Send comment").click();
  // Matches on the short unique marker rather than the full 1800-char
  // string, which getByText can't reliably match against wrapped/truncated
  // rendered text.
  await expect(page.getByText(marker, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  const commentRow = page.getByText(marker, { exact: false }).first().locator("xpath=..");
  await commentRow.getByLabel("Delete comment").click();
  await expect(page.getByText(marker, { exact: false })).not.toBeVisible({ timeout: 10_000 });
});

test("app stays usable when the network is offline", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByText("My list", { exact: true })).toBeVisible();

  await context.setOffline(true);
  try {
    // The offline banner (see components/OfflineBanner.tsx, wired up to
    // @react-native-community/netinfo) is the actual feature being
    // verified here — everything else in this test is just confirming nothing
    // crashes while it's up.
    await expect(page.getByText("No internet connection")).toBeVisible({ timeout: 10_000 });
    await page.getByText("Movies", { exact: true }).click();
    await expect(page).toHaveURL(/\/movies$/);
    await expect(page.getByText("Something went wrong")).not.toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("rapidly switching tabs five times in a row doesn't crash or desync", async ({ page }) => {
  await page.goto("/");
  const tabs = ["Movies", "Explore", "Profile", "Shows"];
  for (let i = 0; i < 5; i++) {
    for (const tabName of tabs) {
      await page.getByText(tabName, { exact: true }).last().click();
    }
  }
  await expect(page.getByText("Something went wrong")).not.toBeVisible();
  // Should have settled on Shows (the last tab pressed) with real content,
  // not a blank/stuck screen from the rapid-fire navigation.
  await expect(page.getByText("My list", { exact: true })).toBeVisible({ timeout: 10_000 });
});
