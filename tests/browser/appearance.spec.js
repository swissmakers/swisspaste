// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Verify background recovery and explicit release checks without external requests
const { test, expect } = require("@playwright/test");

test("reload selects another optimized background without checking GitHub automatically", async ({
  page,
}) => {
  const updates = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/updates")) updates.push(request.url());
  });
  await page.goto("/");
  const background = page.locator("#backgroundImage");
  await expect(background).toBeVisible();
  const first = await background.getAttribute("data-background");
  await page.reload();
  await expect(background).toBeVisible();
  await expect(background).not.toHaveAttribute("data-background", first);
  expect(
    await background.evaluate((image) => image.naturalWidth),
  ).toBeLessThanOrEqual(2560);
  expect(await background.evaluate((image) => image.currentSrc)).toMatch(
    /\/bg_live\/[a-f0-9]{24}-\d+\.webp$/,
  );
  expect(updates).toEqual([]);
});

test("failed background and blocked storage preserve session creation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, key, {
        get() {
          throw new Error("storage blocked");
        },
      });
    }
  });
  await page.route("**/bg_live/manifest.json", (route) =>
    route.fulfill({ status: 500 }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: "Create session", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
  await expect(page.locator("#backgroundImage")).toBeHidden();
});

test("update feedback handles a new version, translation, no tags and upstream failure", async ({
  page,
}) => {
  let result = {
    status: "available",
    current: "1.0.0",
    latest: "1.10.0",
    url: "https://github.com/swissmakers/swisspaste/tree/v1.10.0",
  };
  await page.route("**/api/updates", (route) =>
    route.fulfill({ json: result }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.locator("#updateStatus")).toHaveText(
    "New version available: v1.10.0.",
  );
  await expect(page.locator("#updateLink")).toHaveAttribute("href", result.url);
  await page.getByRole("button", { name: "DE", exact: true }).click();
  await expect(page.locator("#updateStatus")).toHaveText(
    "Neue Version verfügbar: v1.10.0.",
  );
  result = { status: "no_releases" };
  await page.locator("#checkUpdatesBtn").click();
  await expect(page.locator("#updateStatus")).toHaveText(
    "Noch keine stabilen Versionen veröffentlicht.",
  );
  await expect(page.locator("#updateLink")).toBeHidden();
  await page.route("**/api/updates", (route) => route.abort());
  await page.locator("#checkUpdatesBtn").click();
  await expect(page.locator("#updateStatus")).toHaveText(
    "Updates konnten nicht geprüft werden. Versuche es später erneut.",
  );
  await expect(page.locator("#checkUpdatesBtn")).toBeEnabled();
});

test("desktop and mobile keep the footer usable in light and dark themes", async ({
  page,
}) => {
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.locator("#themeToggle").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("#backgroundImage")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.locator("#checkUpdatesBtn").scrollIntoViewIfNeeded();
      await expect(page.locator("#checkUpdatesBtn")).toBeInViewport();
      await page.screenshot({
        path: `/tmp/swisspaste-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  }
});
