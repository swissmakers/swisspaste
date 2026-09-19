# Asset management

[README](../README.md) | [Contributing](../CONTRIBUTING.md) | [Releases](RELEASES.md)

The build generates browser bundles, PDF support assets, responsive backgrounds and application icons. Go embeds these outputs in the executable. Changing files in a checkout does not update a running instance. Rebuild the binary or container and replace the instance to serve the new assets.

| Source | Generated output | Included at runtime |
| --- | --- | --- |
| `web/editor.js` and npm dependencies | `web/static/editor.bundle.js` and `editor.LICENSE.txt` | Editor, QR generator and dependency notices. |
| `web/preview.js`, `web/pdf.js` and PDF.js | `preview.bundle.js`, `pdf.bundle.js`, `pdf.worker.js` and `web/static/pdf/` | Preview renderer, PDF worker, character maps and fonts. |
| `web/static/img/bg_source/` | `web/static/img/bg_live/` | WebP variants and their manifest. |
| `web/static/img/logo/logo.png` | Icons in `web/static/img/logo/` | Generated icons only. |
| Public landing page on an isolated instance | `web/static/img/previews/desktop.png` and `mobile.png` | Installation previews and the desktop social preview. |

Keep originals in the source locations. Do not edit generated files directly. Both original photographs and the source logo are excluded from the embedded runtime assets.

## Regenerate all assets

**Prerequisites:** Node.js 24.21.0 with npm and dependencies installed with `npm ci`. Run commands from the repository root.

1. Generate the editor bundle, dependency notices, backgrounds and icons. The build reports the generated image counts and background size.

   ```bash
   npm run build
   ```

2. Review the generated changes and the appearance in both light and dark themes.
3. Rebuild the [local binary](../CONTRIBUTING.md#build-and-run-locally) or follow the [container validation and replacement procedure](DEPLOYMENT.md#validate-a-candidate).

The container build runs the same asset pipeline. A separate local asset build is not required before building the container.

File preview code loads when a participant opens a preview. The PDF renderer and worker load only for PDF previews. The build copies the worker from the same pinned PDF.js package as the renderer, including supporting font and character-map licenses. Keep these generated files together when rebuilding.

## Background images

Add JPEG, PNG, WebP or AVIF files directly to `web/static/img/bg_source/`. Each image must contain no more than 100 million pixels. The build preserves the source files and replaces the generated background directory. An invalid image fails the build.

| Processing stage | Output |
| --- | --- |
| Orientation and color | Automatic orientation and sRGB conversion. |
| Image adjustment | Mild contrast normalization, saturation adjustment and sharpening. |
| Resize | Up to three variants bounded by 960 x 720, 1920 x 1440 and 2560 x 1920 pixels, without enlargement. |
| Encoding | WebP with EXIF and GPS metadata removed. |
| Naming | Content-based filenames, served with one-year immutable caching. |
| Manifest | Source filenames and variant dimensions for browser selection. |

To regenerate only backgrounds, use the same prerequisites as the full build. This command replaces `bg_live/` and its manifest:

```bash
node scripts/build-backgrounds.mjs
```

Each full page reload selects an image at random. When session storage is available, the browser avoids the previous image in that tab. It downloads a variant suited to the viewport. Theme overlays keep text readable over the photograph. An empty source directory or an image loading failure leaves a neutral background.

## Logo and icons

Replace `web/static/img/logo/logo.png` to update the application branding. The logo must contain no more than 25 million pixels. The build preserves the source and generates 13 files in the same directory. Derivatives have trimmed margins and no source metadata.

To regenerate only the logo and favicons, use the same prerequisites as the full build. This command replaces all generated logo and installation icons:

```bash
node scripts/build-logo.mjs
```

| Asset | Dimensions in pixels | Purpose |
| --- | --- | --- |
| `logo-*.png` | 16, 32, 48, 64, 96, 128, 256 | Transparent UI logos and browser icons. |
| `favicon.ico` | 16, 32, 48 | Multi-resolution browser icon. |
| `apple-touch-icon.png` | 180 | iPhone and iPad home screen icon. |
| `icon-*.png` | 192, 512 | Installation icons on an opaque white background. |
| `icon-maskable-*.png` | 192, 512 | Installation icons with padding for platform masks. |

The [web app manifest](../web/static/app.webmanifest) uses a fixed root launch URL without a session code. The application does not register a service worker or maintain an offline content cache. See [browser installation](../README.md#browser-installation-and-appearance) for installation behavior.

## Refresh installation previews

The manifest includes desktop and phone screenshots of the public landing page. The server also uses the desktop image for social previews when `SWISSPASTE_PUBLIC_URL` is configured. These PNG files are checked in and copied into the container build. The normal asset build does not recapture them.

**Prerequisites:** installed npm dependencies, the pinned Playwright Chromium browser, and an isolated local build serving the current interface at `http://127.0.0.1:18080`. Use default retention settings and disabled participant details. Do not capture a live session.

1. Capture the landing page in light mode at both manifest dimensions. The script accepts only a loopback origin, uses fresh browser contexts and selects a fixed background. It writes `desktop.png` at 1280 x 800 pixels and `mobile.png` at 390 x 844 pixels.

   ```bash
   npm run capture:previews
   ```

2. Inspect both images. Confirm that the logo and text render correctly and that neither image contains session codes, participant details or shared content.
3. Rebuild the binary or container to embed the updated images. The embedding tests verify their availability and manifest dimensions.

## Third-party credits

CodeMirror, the QR generator, PDF.js and bundled dependencies retain their notices in [editor.LICENSE.txt](../web/static/editor.LICENSE.txt). Font and character-map licenses also accompany their generated assets under `web/static/pdf/`. The browser build regenerates these files from installed packages. Node.js and image processing tools run during the build and are not included in the runtime container.

The supplied photograph filenames identify the photographers and Unsplash photo IDs below. These references are inferred from the filenames. Verify the source pages and redistribution permissions before publication. Photograph licenses are separate from the swissPaste AGPL license, and generated variants remain derivatives of their source photographs.

| Source file | Photographer | Source reference |
| --- | --- | --- |
| `austin-distel-TluMvvrZ57g-unsplash.jpg` | Austin Distel | [Unsplash photo](https://unsplash.com/photos/TluMvvrZ57g) |
| `bench-accounting-C3V88BOoRoM-unsplash.jpg` | Bench Accounting | [Unsplash photo](https://unsplash.com/photos/C3V88BOoRoM) |
| `craig-mckay-vJwzxQK7FaE-unsplash.jpg` | Craig McKay | [Unsplash photo](https://unsplash.com/photos/vJwzxQK7FaE) |
| `damian-markutt-GGHFVJ8eoqE-unsplash.jpg` | Damian Markutt | [Unsplash photo](https://unsplash.com/photos/GGHFVJ8eoqE) |
| `damian-markutt-vaG8rOJLDHo-unsplash.jpg` | Damian Markutt | [Unsplash photo](https://unsplash.com/photos/vaG8rOJLDHo) |
| `daniel-sessler-2h5ezBFW5Rw-unsplash.jpg` | Daniel Sessler | [Unsplash photo](https://unsplash.com/photos/2h5ezBFW5Rw) |
| `farshad-rezvanian-Eelegt4hFNc-unsplash.jpg` | Farshad Rezvanian | [Unsplash photo](https://unsplash.com/photos/Eelegt4hFNc) |
| `lucas-benjamin-wQLAGv4_OYs-unsplash.jpg` | Lucas Benjamin | [Unsplash photo](https://unsplash.com/photos/wQLAGv4_OYs) |
