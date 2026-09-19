// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Keep source logos intact and installation artwork inside the maskable safe area

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildLogo } from "./build-logo.mjs";

test("logo variants preserve the source, strip metadata and respect icon masks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "swisspaste-logo-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "logo.png");
  const original = await sharp({
    create: { width: 240, height: 180, channels: 4, background: "#ef1234" },
  })
    .extend({
      top: 20,
      bottom: 20,
      left: 20,
      right: 20,
      background: "#00000000",
    })
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();
  await writeFile(source, original);
  await writeFile(join(directory, "keep.txt"), "preserved");
  const files = await buildLogo(source, directory);
  assert.equal(files.length, 13);
  assert.deepEqual(await readFile(source), original);
  assert.equal(
    await readFile(join(directory, "keep.txt"), "utf8"),
    "preserved",
  );
  for (const file of files.filter((name) => name.endsWith(".png"))) {
    const path = join(directory, file);
    const size =
      file === "apple-touch-icon.png"
        ? 180
        : Number(file.match(/(\d+)\.png$/)[1]);
    const metadata = await sharp(path).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    if (!file.startsWith("logo-")) assert.equal(metadata.hasAlpha, false);
    if (!file.includes("maskable")) continue;
    const { data, info } = await sharp(path)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * info.channels;
        if (
          data[offset] < 250 ||
          data[offset + 1] < 250 ||
          data[offset + 2] < 250
        ) {
          assert.ok(
            Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size * 0.4,
          );
        }
      }
    }
  }
  const ico = await readFile(join(directory, "favicon.ico"));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    const length = ico.readUInt32LE(entry + 8),
      offset = ico.readUInt32LE(entry + 12);
    assert.equal(ico[entry], size);
    assert.deepEqual(
      ico.subarray(offset, offset + length),
      await readFile(join(directory, `logo-${size}.png`)),
    );
  }
  await writeFile(source, "invalid image");
  await assert.rejects(buildLogo(source, directory));
  assert.deepEqual(await readFile(join(directory, "favicon.ico")), ico);
});
