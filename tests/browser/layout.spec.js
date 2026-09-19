// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Preserve mobile navigation and editing across responsive layouts
const { test, expect } = require("@playwright/test");

for (const width of [320, 390]) {
  test(`mobile tabs preserve text and expose received files at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/");
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.locator("#newSessionBtn")).toBeInViewport();
    await expect(page.locator("#joinBtn")).toBeInViewport();
    await page.locator("#newSessionBtn").click();
    await expect(page.locator("#connectionStatus")).toHaveText("Synced");
    const code = new URL(page.url()).pathname.split("/").pop();
    await expect(page.locator(".brand-name")).toBeVisible();
    await page.locator(".cm-content").fill("Text stays while changing panels");
    await expect(page.locator("#connectionStatus")).toHaveText("Synced");
    const uploaded = await request.post(`/api/sessions/${code}/files`, {
      headers: { "X-Filename": "received.txt" },
      data: "received file",
    });
    expect(uploaded.status()).toBe(201);
    await expect(page.locator("#tabFileCount")).toHaveText("1");
    await page.locator("#textTab").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#filesTab")).toBeFocused();
    await expect(page.locator("#editorPane")).toBeHidden();
    await expect(page.locator("#dropzone")).toBeInViewport();
    await expect(page.locator(".fileitem-name")).toHaveText("received.txt");
    await page.keyboard.press("Home");
    await expect(page.locator("#textTab")).toBeFocused();
    await expect(page.locator(".cm-content")).toHaveText(
      "Text stays while changing panels",
    );
    await page.setViewportSize({ width, height: 420 });
    await page.locator(".cm-content").click();
    await page.keyboard.press("End");
    await page.keyboard.type(".");
    await expect(page.locator("#connectionStatus")).toHaveText("Synced");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(page.locator("#workspaceTabs")).toBeHidden();
    await expect(page.locator("#editorPane")).toBeVisible();
    await expect(page.locator("#filesPane")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText(
      "Text stays while changing panels",
    );
  });
}

test("page metadata remains generic after joining and changing language", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/sessions");
  const { code } = await response.json();
  await page.goto(`/s/${code}`);
  await expect(page.locator("#connectionStatus")).toHaveText("Synchronisiert");
  await page.locator(".cm-content").fill("private metadata test content");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page).toHaveTitle("swissPaste - Share text and files");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "en_GB",
  );
  const head = await page.locator("head").innerHTML();
  expect(head).not.toContain(code);
  expect(head).not.toContain("private metadata test content");
  expect(head).not.toContain("{{PUBLIC_META}}");
});
