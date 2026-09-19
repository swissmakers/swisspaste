// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Capture public landing pages without session data for installation previews
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const origin = new URL(process.argv[2] || "http://127.0.0.1:18080");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw new Error("Preview capture requires an isolated loopback instance");
const destination = "web/static/img/previews";
await mkdir(destination, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, width, height] of [
    ["desktop", 1280, 800],
    ["mobile", 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: "light",
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.route("**/bg_live/manifest.json", async (route) => {
      const response = await route.fetch();
      const manifest = await response.json();
      await route.fulfill({
        response,
        json: { images: manifest.images.slice(0, 1) },
      });
    });
    await page.goto(origin.href);
    await expect(page.locator("#landing")).toBeVisible();
    await expect(page.locator("#workspace")).toBeHidden();
    await expect(page.locator("#backgroundImage")).toBeVisible();
    await page.locator("#backgroundImage").evaluate((image) => image.decode());
    await page.screenshot({ path: `${destination}/${name}.png` });
    await context.close();
    console.log(`Captured ${name} preview ${width}x${height}`);
  }
} finally {
  await browser.close();
}
