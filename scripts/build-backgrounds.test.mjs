// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Verify image bounds and metadata removal without touching supplied photographs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import sharp from "sharp";
import { buildBackgrounds } from "./build-backgrounds.mjs";

test("background build preserves originals, bounds sizes and removes metadata and stale assets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swisspaste-images-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"),
    output = join(root, "output");
  await mkdir(source);
  await mkdir(output);
  await writeFile(join(output, "stale.webp"), "old");
  const original = await sharp({
    create: { width: 2800, height: 2000, channels: 3, background: "#6789ab" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  await writeFile(join(source, "photo.JPG"), original);
  await writeFile(join(source, "notes.txt"), "ignored");
  const manifest = await buildBackgrounds(source, output);
  assert.deepEqual(await readFile(join(source, "photo.JPG")), original);
  assert.equal(manifest.images.length, 1);
  assert.equal(manifest.images[0].variants.length, 3);
  for (const variant of manifest.images[0].variants) {
    const image = await sharp(join(output, basename(variant.url))).metadata();
    assert.equal(image.format, "webp");
    assert.equal(image.exif, undefined);
    assert.equal(image.icc, undefined);
    assert.equal(image.orientation, undefined);
    assert.equal(image.width, variant.width);
    assert.ok(image.width < image.height);
    assert.ok(image.width <= 2560 && image.height <= 1920);
    assert.ok(variant.bytes < original.length);
  }
  assert.ok(!(await readdir(output)).includes("stale.webp"));
  await writeFile(join(source, "broken.jpg"), "invalid");
  await assert.rejects(buildBackgrounds(source, output));
  assert.deepEqual(
    JSON.parse(await readFile(join(output, "manifest.json"))),
    manifest,
  );
  await rm(join(source, "broken.jpg"));
  await rm(join(source, "photo.JPG"));
  assert.deepEqual(await buildBackgrounds(source, output), { images: [] });
  assert.deepEqual(await readdir(output), ["manifest.json"]);
});

test("small images are not enlarged or listed multiple times", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swisspaste-small-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "source"));
  await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#334455" },
  })
    .png()
    .toFile(join(root, "source", "small.png"));
  const manifest = await buildBackgrounds(
    join(root, "source"),
    join(root, "output"),
  );
  assert.equal(manifest.images[0].variants.length, 1);
  assert.equal(manifest.images[0].variants[0].width, 100);
});
