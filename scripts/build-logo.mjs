// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Derive browser and installation icons while preserving the supplied logo

import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildLogo(source, destination) {
  const input = await readFile(source);
  const logo = await sharp(input, { limitInputPixels: 25_000_000 })
    .rotate()
    .trim()
    .toColourspace("srgb")
    .png()
    .toBuffer();
  const outputs = new Map();
  for (const size of [16, 32, 48, 64, 96, 128, 256]) {
    outputs.set(
      `logo-${size}.png`,
      await sharp(logo)
        .resize(size, size, { fit: "contain", background: "#00000000" })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
  }
  for (const [filename, size, scale] of [
    ["apple-touch-icon.png", 180, 0.84],
    ["icon-192.png", 192, 0.84],
    ["icon-512.png", 512, 0.84],
    ["icon-maskable-192.png", 192, 0.56],
    ["icon-maskable-512.png", 512, 0.56],
  ]) {
    const inset = Math.round(size * scale);
    const mark = await sharp(logo)
      .resize(inset, inset, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    outputs.set(
      filename,
      await sharp({
        create: {
          width: size,
          height: size,
          channels: 3,
          background: "#ffffff",
        },
      })
        .composite([{ input: mark, gravity: "centre" }])
        .removeAlpha()
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
  }
  const sizes = [16, 32, 48];
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (const [index, size] of sizes.entries()) {
    const data = outputs.get(`logo-${size}.png`);
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  }
  outputs.set(
    "favicon.ico",
    Buffer.concat([
      directory,
      ...sizes.map((size) => outputs.get(`logo-${size}.png`)),
    ]),
  );
  await mkdir(destination, { recursive: true });
  for (const [filename, data] of outputs)
    await writeFile(join(destination, filename), data);
  return [...outputs.keys()];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const files = await buildLogo(
    "web/static/img/logo/logo.png",
    "web/static/img/logo",
  );
  console.log(`Built ${files.length} logo and installation assets`);
}
