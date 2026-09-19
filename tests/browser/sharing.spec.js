// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Exercise scannable session links, shared language state and safe file previews
const { test, expect } = require("@playwright/test");
const sharp = require("sharp");
const decodeQR = require("jsqr");

async function create(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.locator("#newSessionBtn").click();
  await expect(page.locator("#connectionStatus")).toHaveText("Synced");
  return new URL(page.url()).pathname.split("/").pop();
}

async function upload(page, name, data) {
  const code = new URL(page.url()).pathname.split("/").pop();
  const response = await page.request.post(`/api/sessions/${code}/files`, {
    headers: { "X-Filename": name },
    data,
  });
  expect(response.status()).toBe(201);
  await expect(
    page.getByRole("button", { name: "Preview: " + name, exact: true }),
  ).toBeAttached();
  return response.json();
}

function pdfFixture() {
  const stream = (text) => {
    const value = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
    return `<< /Length ${value.length} >>\nstream\n${value}\nendstream`;
  };
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    stream("First page"),
    stream("Second page"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 8\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("QR decodes to the full current session URL and remains usable on phones", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await create(page);
  await page.locator("#showQRBtn").click();
  await expect(page.locator("#qrDialog")).toBeVisible();
  const data = await page
    .locator("#qrCanvas")
    .evaluate((canvas) => canvas.toDataURL().split(",")[1]);
  const { data: pixels, info } = await sharp(Buffer.from(data, "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(
    decodeQR(new Uint8ClampedArray(pixels), info.width, info.height).data,
  ).toBe(page.url());
  await expect(page.locator("#qrURL")).toHaveAttribute("href", page.url());
  expect(
    await page
      .locator("#qrDialog")
      .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#showQRBtn")).toBeFocused();
  await expect(page.locator("#qrURL")).toBeEmpty();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value) => {
          window.copiedLink = value;
        },
      },
      configurable: true,
    });
  });
  await page.locator("#copyLinkBtn").click();
  expect(await page.evaluate(() => window.copiedLink)).toBe(page.url());
});

test("editor language follows the session through joins, concurrent changes and reconnects", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const first = await a.newPage(),
      second = await b.newPage();
    await create(first);
    await first.locator("#langSelect").selectOption("text/x-go");
    await second.goto(first.url());
    await expect(second.locator("#langSelect")).toHaveValue("text/x-go");
    await first.locator(".cm-content").fill("package main");
    await expect(second.locator(".cm-content")).toHaveText("package main");
    await Promise.all([
      first.locator("#langSelect").selectOption("python"),
      second.locator("#langSelect").selectOption("rust"),
    ]);
    await expect
      .poll(
        async () =>
          (await first.locator("#langSelect").inputValue()) ===
          (await second.locator("#langSelect").inputValue()),
      )
      .toBe(true);
    await a.setOffline(true);
    await expect(first.locator("#langSelect")).toBeDisabled();
    await second.locator("#langSelect").selectOption("yaml");
    await a.setOffline(false);
    await expect(first.locator("#langSelect")).toHaveValue("yaml", {
      timeout: 15000,
    });
    await expect(first.locator("#langSelect")).toBeEnabled();
    await first.reload();
    await expect(first.locator("#langSelect")).toHaveValue("yaml");
    await second.locator("#langSelect").selectOption("");
    await expect(first.locator("#langSelect")).toHaveValue("");
    await expect(first.locator(".cm-content")).toHaveText("package main");
    await first.locator("#leaveBtn").click();
    await first.locator("#newSessionBtn").click();
    await expect(first.locator("#langSelect")).toHaveValue("");
  } finally {
    await a.close();
    await b.close();
  }
});

test("code previews highlight by extension without executing uploaded HTML or SVG", async ({
  page,
}) => {
  await create(page);
  await page.locator(".cm-content").fill("shared document stays here");
  await page.locator("#langSelect").selectOption("python");
  await upload(page, "sample.go", "package main\nfunc main() { println(42) }");
  await page
    .getByRole("button", { name: "Preview: sample.go", exact: true })
    .click();
  const content = page.locator("#previewContent .cm-content");
  await expect(content).toContainText("package main");
  await expect(content).toHaveAttribute("contenteditable", "false");
  await expect
    .poll(() => content.locator("span[class]").count())
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  for (const [name, payload] of [
    ["unsafe.html", "<script>window.previewExecuted = true</script>"],
    [
      "unsafe.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.previewExecuted = true"/>',
    ],
  ]) {
    await upload(page, name, payload);
    await page
      .getByRole("button", { name: "Preview: " + name, exact: true })
      .click();
    await expect(content).toHaveText(payload);
    expect(await page.evaluate(() => window.previewExecuted)).toBeUndefined();
    await expect(
      page.locator(
        "#previewContent iframe, #previewContent object, #previewContent script, #previewContent svg",
      ),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await expect(page.locator("#editorHost .cm-content")).toHaveText(
    "shared document stays here",
  );
  await expect(page.locator("#langSelect")).toHaveValue("python");
  await expect(page.locator("#previewContent")).toBeEmpty();
});

test("image previews support download and disappear when another participant deletes the file", async ({
  page,
}) => {
  const code = await create(page);
  const png = await sharp({
    create: { width: 30, height: 20, channels: 3, background: "#b01225" },
  })
    .png()
    .toBuffer();
  const file = await upload(page, "image.png", png);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#filesTab").click();
  await page
    .getByRole("button", { name: "Preview: image.png", exact: true })
    .click();
  const image = page.locator("#previewContent img");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((image) => image.naturalWidth))
    .toBe(30);
  const objectURL = await image.getAttribute("src");
  await expect(page.locator("#previewDownload")).toHaveAttribute(
    "download",
    "image.png",
  );
  const downloading = page.waitForEvent("download");
  await page.locator("#previewDownload").click();
  expect((await downloading).suggestedFilename()).toBe("image.png");
  await page.request.delete(`/api/sessions/${code}/files/${file.id}`);
  await expect(page.locator("#previewContent")).toContainText(
    "deleted or has expired",
  );
  await expect(image).toHaveCount(0);
  await expect(page.locator("#previewDownload")).toBeHidden();
  expect(
    await page.evaluate(
      (url) =>
        fetch(url).then(
          () => true,
          () => false,
        ),
      objectURL,
    ),
  ).toBe(false);
});

test("PDF previews render locally with page navigation on mobile", async ({
  page,
}) => {
  const requests = [],
    errors = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await create(page);
  const file = pdfFixture();
  expect(file.length).toBeLessThanOrEqual(1024);
  await upload(page, "document.pdf", file);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#filesTab").click();
  await page
    .getByRole("button", { name: "Preview: document.pdf", exact: true })
    .click();
  await expect(page.locator(".pdf-toolbar")).toContainText("Page 1 / 2");
  const first = await page
    .locator(".pdf-paper canvas")
    .evaluate((canvas) => canvas.toDataURL());
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".pdf-toolbar")).toContainText("Page 2 / 2");
  expect(
    await page
      .locator(".pdf-paper canvas")
      .evaluate((canvas) => canvas.toDataURL()),
  ).not.toBe(first);
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(page.locator(".pdf-toolbar")).toContainText("Page 1 / 2");
  const origin = new URL(page.url()).origin;
  expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
  expect(errors).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#previewContent")).toBeEmpty();
});

test("unsupported, corrupt and oversized previews retain a download fallback", async ({
  page,
}) => {
  await create(page);
  for (const [name, body, message] of [
    ["archive.zip", "binary", "No preview"],
    ["broken.png", "not an image", "Could not load"],
    ["broken.pdf", "not a pdf", "Could not load"],
  ]) {
    await upload(page, name, body);
    await page
      .getByRole("button", { name: "Preview: " + name, exact: true })
      .click();
    await expect(page.locator("#previewContent")).toContainText(message);
    await expect(page.locator("#previewDownload")).toBeVisible();
    await page.keyboard.press("Escape");
  }
  const file = await upload(page, "large.txt", "small metadata");
  await page.route("**/files/" + file.id, (route) =>
    route.fulfill({ body: "x".repeat(1024 * 1024 + 1) }),
  );
  await page
    .getByRole("button", { name: "Preview: large.txt", exact: true })
    .click();
  await expect(page.locator("#previewContent")).toContainText(
    "too large to preview",
  );
  await expect(page.locator("#previewContent .cm-editor")).toHaveCount(0);
});

test("closing an in-flight preview cannot replace the next file preview", async ({
  page,
}) => {
  await create(page);
  const slow = await upload(page, "slow.txt", "obsolete content");
  await upload(page, "current.txt", "current preview");
  let release;
  let intercepted = false;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/files/" + slow.id, async (route) => {
    intercepted = true;
    await pending;
    await route.fulfill({ body: "obsolete content" }).catch(() => {});
  });
  try {
    await page
      .getByRole("button", { name: "Preview: slow.txt", exact: true })
      .click();
    await expect.poll(() => intercepted).toBe(true);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Preview: current.txt", exact: true })
      .click();
    release();
    await expect(page.locator("#previewContent .cm-content")).toHaveText(
      "current preview",
    );
    await expect(page.locator("#previewTitle")).toHaveText("current.txt");
    await page.keyboard.press("Escape");
    await expect(page.locator("#previewContent")).toBeEmpty();
  } finally {
    release();
  }
});

test("audio uses local playback controls and clears its object URL on close", async ({
  page,
}) => {
  await create(page);
  const wav = Buffer.alloc(204, 128);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(196, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(160, 40);
  await upload(page, "sound.wav", wav);
  await page
    .getByRole("button", { name: "Preview: sound.wav", exact: true })
    .click();
  const audio = page.locator("#previewContent audio");
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute("controls", "");
  await expect
    .poll(() => audio.evaluate((media) => media.duration))
    .toBeGreaterThan(0);
  const url = await audio.getAttribute("src");
  await page.keyboard.press("Escape");
  await expect(page.locator("#previewContent")).toBeEmpty();
  expect(
    await page.evaluate(
      (url) =>
        fetch(url).then(
          () => true,
          () => false,
        ),
      url,
    ),
  ).toBe(false);
});

test("an open preview clears when the file lifetime elapses", async ({
  page,
}) => {
  await page.clock.install();
  await create(page);
  await upload(page, "expires.txt", "temporary preview content");
  await page
    .getByRole("button", { name: "Preview: expires.txt", exact: true })
    .click();
  await expect(page.locator("#previewContent .cm-content")).toHaveText(
    "temporary preview content",
  );
  await page.clock.fastForward(16 * 60 * 1000);
  await expect(page.locator("#previewContent")).toContainText(
    "deleted or has expired",
  );
  await expect(page.locator("#previewContent .cm-content")).toHaveCount(0);
  await expect(page.locator("#previewDownload")).toBeHidden();
});
