# Browser installation

[README](../README.md) | [Asset management](ASSETS.md) | [Security and data retention](REVIEW.md)

swissPaste supports browser installation as a progressive web app. The installed application opens the home page in a standalone window and requires a connection to the server. Installation behavior depends on the browser and operating system.

## Install the application

**Prerequisites:** a supported, updated browser and the application served over HTTPS. Loopback HTTP addresses support local testing.

1. Open the public home page in the browser.
2. Select **Install app** in the footer when available, or use the browser's installation menu. On iPhone or iPad, select **Add to Home Screen** from Safari's share menu.
3. Launch the installed application. It opens the home page without retaining the session used during installation.

The footer button appears only after the browser supplies an installation prompt. It stays hidden when installation is unavailable or the app already runs in standalone mode. Browser engagement rules can delay the prompt. Chrome's current [installation criteria](https://web.dev/articles/install-criteria) cover HTTPS, interaction and required manifest fields.

## Manifest and page metadata

| Field | Behavior |
| --- | --- |
| Identity, launch URL and scope | Fixed at `/`, independent of session URLs. |
| Display | Standalone, without a forced orientation. |
| Icons | 192 and 512 pixel PNGs with separate regular and maskable variants. |
| Screenshots | Desktop and phone landing pages, with dimensions, labels and form factors. |
| Default locale | Swiss German, matching the initial interface. |
| Page title and description | Generic application text, updated when the participant changes language. |
| Canonical and social URLs | Public root and a static preview image, enabled by `SWISSPASTE_PUBLIC_URL`. |

The manifest description and screenshots support Chrome's [richer installation dialog](https://web.dev/articles/web-apps/richer-install-ui). Generate previews through the [asset procedure](ASSETS.md#refresh-installation-previews) after changing the landing page.

The application requests no camera, microphone or location permissions. It registers no service worker and stores no offline session content. Appearance preferences can use browser storage. A browser can fetch public manifest data and icons through its installation infrastructure when creating an Android package. See Google's [WebAPK documentation](https://web.dev/articles/webapks) for that process.

## Samsung Internet reports an outdated Android app

An open [Samsung Internet issue](https://github.com/SamsungInternet/support/issues/123) reports an older-Android privacy warning when installing a PWA, while installation through Chrome succeeds on the same device. This matches the reported Galaxy S23 behavior. The report's explanation about Samsung's generated package remains a hypothesis, not a confirmed diagnosis of this device.

Google documents the [older Android compatibility warning](https://developers.google.com/android/play-protect/warning-dev-guidance) as a check of the Android package's target SDK. A web manifest has no `targetSdkVersion` setting. HTML metadata cannot repair an outdated browser-generated package.

**Prerequisites:** access to the device's browser updates and the public HTTPS site.

1. Update Samsung Internet and Android through the device's normal update channels.
2. Retry installation from the public home page.
3. If the warning remains, open the same site in an updated Chrome browser and use its installation menu. Alternatively, continue using swissPaste in a browser tab.
4. Record the exact warning, Android version and Samsung Internet version if the problem persists. Include these details when following up on the browser issue.

Keep Play Protect enabled. Desktop Chromium checks validate the manifest and web installation requirements, but cannot verify Samsung's package generation or the final Android installation on a Galaxy S23.

## Privacy boundaries

An Android compatibility warning does not establish whether an operator's deployment meets data protection law. The application avoids third-party frontend services, shared content in installation metadata and offline content caches. Deployment privacy also depends on proxy logging, host storage, access controls and the operator's notices. Review the implemented controls and limits in [security and data retention](REVIEW.md).
