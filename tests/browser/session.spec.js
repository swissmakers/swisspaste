// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Verify shared sessions and browser recovery across clients
const { test, expect } = require("@playwright/test");

async function create(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: "Create session", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
}

test("sync, reconnect without overwriting remote content, upload and delete", async ({
  page,
  context,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator("#connectionStatus")).toHaveText("Synced");
  await page.locator(".cm-content").fill("Hello <script>alert(1)</script>");
  await expect(other.locator(".cm-content")).toHaveText(
    "Hello <script>alert(1)</script>",
  );
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
  await page.reload();
  await expect(page.locator(".cm-content")).toHaveText(
    "Hello <script>alert(1)</script>",
  );
  await page.locator("#fileInput").setInputFiles({
    name: "a+b'.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("test file"),
  });
  await expect(other.locator(".fileitem-name")).toHaveText("a+b'.txt");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Remove: a+b'.txt", exact: true })
    .click();
  await expect(other.locator(".fileitem")).toHaveCount(0);
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.locator("#landing")).toBeVisible();
  await other.locator(".cm-content").fill("Session remains active");
  await expect(other.locator("#connectionStatus")).toHaveText("Synced");
  expect(errors).toEqual([]);
});

test("offline edits are disabled and reconnect does not resend stale text", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const first = await a.newPage(),
    second = await b.newPage();
  await create(first);
  await second.goto(first.url());
  await expect(second.locator("#connectionStatus")).toHaveText(
    "Synchronisiert",
  );
  await first.locator(".cm-content").fill("before disconnect");
  await expect(first.locator("#connectionStatus")).toHaveText("Synced");
  await a.setOffline(true);
  await expect(first.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await second.locator(".cm-content").fill("newer remote text");
  await expect(second.locator("#connectionStatus")).toHaveText(
    "Synchronisiert",
  );
  await a.setOffline(false);
  await expect(first.locator(".cm-content")).toHaveText("newer remote text", {
    timeout: 15000,
  });
  await expect(second.locator(".cm-content")).toHaveText("newer remote text");
  await a.close();
  await b.close();
});

test("mobile layout fits viewport and has keyboard-accessible editor controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await create(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await expect(
    page.getByRole("button", { name: "Leave", exact: true }),
  ).toBeInViewport();
  const leave = await page.locator("#leaveBtn").boundingBox();
  const ttl = await page.locator("#sessionTtl").boundingBox();
  expect(leave.x + leave.width).toBeLessThanOrEqual(375);
  expect(ttl.x + ttl.width).toBeLessThanOrEqual(375);
  await expect(
    page.getByRole("button", { name: "Copy text", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "aria-label",
    "Shared text",
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".cm-content")).not.toBeFocused();
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await page.locator("#dropzone").scrollIntoViewIfNeeded();
  await expect(page.locator("#dropzone")).toBeInViewport();
  await page.screenshot({ path: "/tmp/swisspaste-mobile.png", fullPage: true });
});

test("blocked storage does not prevent startup", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("storage blocked");
      },
    });
  });
  await create(page);
  await expect(page.locator(".cm-content")).toBeVisible();
});

test("non-default limits and failed delete are reflected correctly", async ({
  page,
}) => {
  await create(page);
  await expect(page.locator("#dropSub")).toHaveText("Per file: 1.0 KiB");
  await page.locator("#fileInput").setInputFiles({
    name: "keep.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("keep"),
  });
  await expect(page.locator(".fileitem-name")).toHaveText("keep.txt");
  await page.route("**/files/*", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 500 })
      : route.continue(),
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Remove: keep.txt", exact: true })
    .click();
  await expect(page.locator("#toast")).toHaveText("Could not remove the file.");
  await expect(page.locator(".fileitem-name")).toHaveText("keep.txt");
});

test("an interrupted send is recoverable without silently overwriting the session", async ({
  page,
}) => {
  let interrupt = false;
  await page.routeWebSocket("**/ws/*", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (interrupt && JSON.parse(String(message)).type === "text") {
        interrupt = false;
        socket.close();
        server.close();
      } else server.send(message);
    });
  });
  await create(page);
  await page.locator(".cm-content").fill("confirmed text");
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
  interrupt = true;
  await page.locator(".cm-content").fill("unsent draft");
  await expect(page.locator("#recoveryPanel")).toBeVisible();
  await expect(page.locator("#recoveryText")).toHaveValue("unsent draft");
  await expect(page.locator(".cm-content")).toHaveText("confirmed text", {
    timeout: 15000,
  });
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
  await page
    .getByRole("button", { name: "Restore recovered text", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
  await expect(page.locator(".cm-content")).toHaveText("unsent draft");
  await expect(page.locator("#recoveryPanel")).toBeHidden();
});

test("leaving clears editor undo history before joining another session", async ({
  page,
}) => {
  await create(page);
  await page.locator(".cm-content").fill("secret from previous session");
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await page
    .getByRole("button", { name: "Create session", exact: true })
    .click();
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("");
});

test("interleaved edits agree with the accepted server revision", async ({
  page,
  context,
}) => {
  let hold = false,
    pending = null,
    forward = null;
  await page.routeWebSocket("**/ws/*", (socket) => {
    const server = socket.connectToServer();
    forward = (message) => server.send(message);
    socket.onMessage((message) => {
      if (hold && JSON.parse(String(message)).type === "text")
        pending = message;
      else server.send(message);
    });
  });
  await create(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator("#connectionStatus")).toHaveText("Synced");
  hold = true;
  await page.locator(".cm-content").fill("delayed local edit");
  await expect.poll(() => pending !== null).toBe(true);
  await other.locator(".cm-content").fill("remote edit accepted first");
  await expect(page.locator(".cm-content")).toHaveText(
    "remote edit accepted first",
  );
  hold = false;
  forward(pending);
  await expect(other.locator(".cm-content")).toHaveText("delayed local edit");
  await expect(page.locator(".cm-content")).toHaveText("delayed local edit");
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
});
