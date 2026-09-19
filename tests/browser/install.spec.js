// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Verify two-state themes and installation without retaining shared content
const { test, expect } = require("@playwright/test");

for (const preference of ["auto", "blocked"]) {
  test(`theme alternates between light and dark with ${preference} storage`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript((preference) => {
      if (preference === "blocked") {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("blocked");
          },
        });
      } else localStorage.setItem("swisspaste:theme", preference);
    }, preference);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "EN", exact: true }).click();
    for (const theme of ["light", "dark", "light", "dark"]) {
      await page.locator("#themeToggle").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("#themeToggle")).toHaveAttribute(
        "aria-label",
        theme === "dark" ? "Use light theme" : "Use dark theme",
      );
      expect(
        await page.evaluate(() => document.documentElement.style.colorScheme),
      ).toBe(theme);
    }
  });
}

test("selected theme survives reload and system preference changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.locator("#themeToggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#themeToggle").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("installing from a session uses the root URL and never creates offline content storage", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/sessions");
  const { code } = await created.json();
  await page.goto(`/s/${code}`);
  await expect(page.locator("#connectionStatus")).toHaveText("Synchronisiert");
  await page.locator(".cm-content").fill("private install test content");
  await expect(page.locator("#connectionStatus")).toHaveText("Synchronisiert");
  const client = await page.context().newCDPSession(page);
  const app = await client.send("Page.getAppManifest");
  expect(app.errors).toEqual([]);
  const manifest = JSON.parse(app.data);
  expect(manifest.id).toBe("/");
  expect(manifest.start_url).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(await client.send("Page.getInstallabilityErrors")).toEqual({
    installabilityErrors: [],
  });
  expect(manifest.screenshots.map((shot) => shot.form_factor).sort()).toEqual([
    "narrow",
    "wide",
  ]);
  for (const shot of manifest.screenshots) {
    const response = await request.get(shot.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  for (const icon of manifest.icons) {
    expect(icon.src).toMatch(/^\/static\/img\/logo\/icon-/);
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  await expect(page.locator(".brand-logo")).toBeVisible();
  expect(
    await page.locator(".brand-logo").evaluate((logo) => logo.naturalWidth),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
  const preferences = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  expect(preferences).not.toContain(code);
  expect(preferences).not.toContain("private install test content");
});

test("installation prompt is offered only when available and requires a click", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("#installAppBtn")).toBeHidden();
  await page.evaluate(() => {
    window.installPrompts = 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {
      window.installPrompts++;
    };
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event);
  });
  await expect(
    page.getByRole("button", { name: "Install app", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.installPrompts)).toBe(0);
  await page.getByRole("button", { name: "Install app", exact: true }).click();
  expect(await page.evaluate(() => window.installPrompts)).toBe(1);
  await expect(page.locator("#installAppBtn")).toBeHidden();
});
