// Smoke E2E covering the critical funnel that drives our core promise:
// SEO articles that pass detectors. Anything below MUST stay green.
//
//   1. Public landing renders (Stealth marketing pitch is reachable).
//   2. Login page is reachable from "/" (no broken navigation).
//   3. Articles route is auth-protected (redirects unauthenticated users away).
//   4. Critical edge functions are deployed and respond (CORS preflight).
//
// Scope is intentionally narrow: deeper auth flows require a seeded test user
// + Turnstile bypass, which we add in a follow-up. This file at minimum
// catches: white screen, dead routes, missing edge functions.

import { test, expect } from "../playwright-fixture";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const STEALTH_FUNCTIONS = [
  "generate-article",
  "rewrite-fragment",
  "inline-edit",
  "bulk-generate",
  "quality-check",
  "check-uniqueness",
];

test.describe("Critical path", () => {
  test("landing page renders without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
    // Body must contain something (no white screen).
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(50);
    expect(errors, `Page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("login route is reachable", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("input[type='email'], input[name='email']").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("articles route is auth-protected", async ({ page }) => {
    await page.goto("/articles");
    await page.waitForLoadState("networkidle");
    // Either redirected to /login OR a login form is shown inline.
    const url = page.url();
    const hasLoginInput = await page
      .locator("input[type='email'], input[type='password']")
      .first()
      .isVisible()
      .catch(() => false);
    expect(url.includes("/login") || hasLoginInput).toBeTruthy();
  });
});

test.describe("Stealth pipeline edge functions", () => {
  test.skip(!SUPABASE_URL, "VITE_SUPABASE_URL not configured");

  for (const fn of STEALTH_FUNCTIONS) {
    test(`${fn} responds to CORS preflight`, async ({ request }) => {
      const res = await request.fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
          Origin: "https://seo-modul.pro",
        },
      });
      // 200/204 = function exists and CORS configured. 404 = function missing.
      expect([200, 204]).toContain(res.status());
    });
  }
});