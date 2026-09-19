// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Bundle the editor and preserve third-party license notices
import { build } from "esbuild";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";

const version = readFileSync("VERSION", "utf8").trim();
const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
if (
  !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) ||
  version !== packageVersion
) {
  throw new Error("VERSION must be a stable version matching package.json");
}

const result = await build({
  entryPoints: ["web/editor.js"],
  bundle: true,
  minify: true,
  format: "iife",
  outfile: "web/static/editor.bundle.js",
  legalComments: "none",
  metafile: true,
  banner: { js: "/* Third-party licenses: editor.LICENSE.txt */" },
});
const packages = new Map();
const previews = await build({
  entryPoints: {
    "preview.bundle": "web/preview.js",
    "pdf.bundle": "web/pdf.js",
  },
  bundle: true,
  minify: true,
  format: "esm",
  outdir: "web/static",
  external: ["/static/pdf.bundle.js"],
  legalComments: "none",
  metafile: true,
  banner: { js: "/* Third-party licenses: editor.LICENSE.txt */" },
});
copyFileSync(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "web/static/pdf.worker.js",
);
rmSync("web/static/pdf", { recursive: true, force: true });
for (const directory of ["cmaps", "standard_fonts"]) {
  cpSync(
    `node_modules/pdfjs-dist/${directory}`,
    `web/static/pdf/${directory}`,
    { recursive: true },
  );
}
for (const input of Object.keys({
  ...result.metafile.inputs,
  ...previews.metafile.inputs,
})) {
  if (!input.startsWith("node_modules/")) continue;
  let directory = dirname(resolve(input));
  while (!existsSync(join(directory, "package.json")))
    directory = dirname(directory);
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const license = ["LICENSE", "LICENSE.txt", "LICENSE.md", "license"].find(
    (name) => existsSync(join(directory, name)),
  );
  if (!license) throw new Error(`Missing license for ${pkg.name}`);
  packages.set(
    pkg.name,
    `${pkg.name} ${pkg.version}\n\n${readFileSync(join(directory, license), "utf8").trim()}`,
  );
}
writeFileSync(
  "web/static/editor.LICENSE.txt",
  [...packages]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([, text]) => text)
    .join("\n\n----------------------------------------\n\n") + "\n",
);
