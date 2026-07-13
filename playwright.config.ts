/// <reference types="node" />
// This file (and its "fs" use just below) is Node-only tooling config, not
// part of the app bundle — the reference above pulls in @types/node just
// for this file instead of adding "types": ["node"] to the shared
// tsconfig.json, which would leak Node globals into the RN/web app code
// where they don't actually exist at runtime.
import { defineConfig } from "@playwright/test";
import { readFileSync, existsSync } from "fs";

// Minimal .env loader — no dotenv dependency in this project (see
// package.json), and Playwright's config runs outside Expo's own env
// loading (that only wraps `expo`/`npx expo` commands), so
// E2E_TEST_EMAIL/E2E_TEST_PASSWORD (see e2e/auth.setup.ts) wouldn't
// otherwise reach process.env here.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const authFile = "e2e/.auth/user.json";

export default defineConfig({
  testDir: "./e2e",
  // Bumped from 30s — after a large batch of source edits, Metro's first
  // bundle rebuild for a given route can genuinely take longer than that to
  // compile and serve, which was timing out page.goto() before the app ever
  // got a chance to render, not because of an actual bug.
  timeout: 90_000,
  fullyParallel: true,
  // The whole suite sharing one real Supabase session/test account against
  // a single local dev server (see webServer below) starts producing
  // timeouts from plain CPU/network contention somewhere past ~6-8
  // concurrent browser pages on a typical dev machine — well before
  // Playwright's own CPU-count-based default worker count. This isn't
  // fixable by making individual tests more patient; it's a resource
  // ceiling.
  workers: 4,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8081",
    trace: "on-first-retry",
    // Same reasoning as the suite-level timeout above — a slow first-compile
    // navigation shouldn't fail before the app even gets a chance to render.
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
  },
  projects: [
    // Logs in once with the dedicated test account (see e2e/auth.setup.ts)
    // and saves the resulting session (including IndexedDB — Supabase's
    // auth storage lives there, see lib/supabase.ts) to authFile, which
    // every "authenticated" test below reuses instead of logging in itself.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "public",
      testMatch: /e2e\/[^/]+\.spec\.ts/,
    },
    {
      name: "authenticated",
      testMatch: /e2e\/authenticated\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: authFile },
    },
  ],
  webServer: {
    command: "npm run web",
    url: "http://localhost:8081",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
