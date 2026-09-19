// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Build responsive backgrounds without modifying the source photographs

import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildBackgrounds(source, destination) {
  const entries = (await readdir(source, { withFileTypes: true }))
    .filter(
      (entry) => entry.isFile() && /\.(jpe?g|png|webp|avif)$/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(dirname(destination), ".backgrounds-"));
  const manifest = { images: [] };
  try {
    for (const name of entries) {
      const input = await readFile(join(source, name));
      const variants = [];
      for (const [width, height, quality] of [
        [960, 720, 72],
        [1920, 1440, 76],
        [2560, 1920, 78],
      ]) {
        const { data, info } = await sharp(input, {
          limitInputPixels: 100_000_000,
        })
          .rotate()
          .resize({ width, height, fit: "inside", withoutEnlargement: true })
          .toColourspace("srgb")
          .normalise({ lower: 1, upper: 99 })
          .modulate({ saturation: 1.04 })
          .sharpen({ sigma: 0.4 })
          .webp({ quality, effort: 5 })
          .toBuffer({ resolveWithObject: true });
        if (variants.some((variant) => variant.width === info.width)) continue;
        const hash = createHash("sha256")
          .update(data)
          .digest("hex")
          .slice(0, 24);
        const filename = `${hash}-${info.width}.webp`;
        await writeFile(join(staging, filename), data);
        variants.push({
          url: `/static/img/bg_live/${filename}`,
          width: info.width,
          height: info.height,
          bytes: data.length,
        });
      }
      manifest.images.push({
        id: createHash("sha256").update(input).digest("hex").slice(0, 24),
        source: name,
        variants,
      });
    }
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    return manifest;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const manifest = await buildBackgrounds(
    "web/static/img/bg_source",
    "web/static/img/bg_live",
  );
  const bytes = manifest.images
    .flatMap((image) => image.variants)
    .reduce((sum, variant) => sum + variant.bytes, 0);
  console.log(
    `Built ${manifest.images.length} backgrounds, ${(bytes / 1024 / 1024).toFixed(2)} MiB across all sizes`,
  );
}
