import { test, expect, Page } from "@playwright/test";

// Both tests below operate on the exact same movie on the same shared test
// account — run in parallel (this project's default), they race each
// other's watched/rating state. This runs the whole file's tests one at a
// time instead.
test.describe.configure({ mode: "serial" });

// TMDB id 550 — Fight Club, a stable/permanent title unlikely to ever be
// removed from TMDB. Direct route (app/movie/tmdb/[id].tsx) needs no
// search step first.
const MOVIE_ID = 550;
const MOVIE_TITLE = "Fight Club";

// A previous run can leave this movie already marked watched if it
// crashed/timed out before reaching its own cleanup — self-healing this
// rather than assuming a pristine starting state is what makes the suite
// reliable to re-run after a flake.
async function ensureUnwatched(page: Page) {
  const markAsNotWatched = page.getByLabel("Mark as not watched");
  if (await markAsNotWatched.isVisible().catch(() => false)) {
    await markAsNotWatched.click();
    await expect(page.getByLabel("Mark as watched")).toBeVisible({ timeout: 10_000 });
  }
}

test("movie detail page renders title and cast", async ({ page }) => {
  await page.goto(`/movie/tmdb/${MOVIE_ID}`);
  await expect(page.getByText(MOVIE_TITLE, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Cast", { exact: true })).toBeVisible({ timeout: 15_000 });
});

// End-to-end: mark watched (this alone creates the watchlist row — see
// handleToggleWatched in app/movie/tmdb/[id].tsx, no separate "add to
// watchlist" step needed), rate, react, comment — then undo everything so
// this dedicated test account's history stays clean across runs.
test("can mark a movie watched, rate it, react, and comment", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/movie/tmdb/${MOVIE_ID}`);
  await expect(page.getByText(MOVIE_TITLE, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await ensureUnwatched(page);

  // "Mark as watched" only renders once userRowLoaded flips (see
  // app/movie/tmdb/[id].tsx) — that's a Supabase round trip racing several
  // TMDB detail/cast/trailer/providers/recommendations fetches on the same
  // page load, so it can take a while longer than the default 5s wait.
  await expect(page.getByLabel("Mark as watched")).toBeVisible({ timeout: 45_000 });
  await page.getByLabel("Mark as watched").click();
  await expect(page.getByText("Your rating", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Rate 5 stars").click();

  await expect(page.getByText("How did it make you feel?", { exact: true })).toBeVisible();
  await page.getByText("Touched", { exact: true }).click();

  const uniqueComment = `e2e movie comment ${Date.now()}`;
  await page.getByPlaceholder("Add a comment...").fill(uniqueComment);
  await page.getByLabel("Send comment").click();
  await expect(page.getByText(uniqueComment)).toBeVisible({ timeout: 15_000 });

  // Cleanup: delete the comment, then unmark watched (drops the
  // rating/feeling with it — see setMovieWatched(..., false) in
  // lib/userMovies.ts). The comment body Text and its row's delete button
  // are siblings under the same commentRow View (see
  // components/CommentsSection.tsx) — going up one level from the body
  // text lands directly on that row.
  const commentRow = page.getByText(uniqueComment, { exact: true }).locator("xpath=..");
  await commentRow.getByLabel("Delete comment").click();
  await expect(page.getByText(uniqueComment)).not.toBeVisible({ timeout: 10_000 });

  await page.getByLabel("Mark as not watched").click();
  await expect(page.getByText("Your rating", { exact: true })).not.toBeVisible({ timeout: 10_000 });
});
