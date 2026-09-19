# Security and data retention

[README](../README.md) | [Configuration](CONFIGURATION.md) | [Deployment](DEPLOYMENT.md)

This document describes the application's access model, data lifetime and tested controls. It records implementation boundaries, not a certification or an independent security audit.

## Session access

A session code is a bearer secret. Anyone holding it can read and replace text, upload and download files, and delete files in that session. swissPaste has no accounts, participant roles or per-user revocation. Keep codes and shared links within the intended group.

The server can read shared content. HTTPS encrypts traffic between the browser and the TLS endpoint; the application does not provide end-to-end encryption. Use HTTPS and deployment-level access controls before exposing the service outside loopback.

HTTP mutations and WebSocket upgrades validate the request origin. Origin checks constrain browser requests but do not authenticate API clients. Trust forwarded headers only when the application is reachable through a trusted proxy that overwrites those headers.

## Data retention

| Data | Storage and lifetime |
| --- | --- |
| Session state and text | Server memory until session expiry or process shutdown. |
| Uploaded files | Private spool files until file or session expiry, participant deletion or graceful shutdown. The supplied deployment mounts the spool on tmpfs. |
| Recovery text | Memory in the current browser tab. Closing or reloading the tab can discard it. |
| File previews | Browser memory while the preview is open. Closing the preview, leaving the session, or receiving file deletion or expiry clears the preview and releases its object URLs and renderer. |
| Session codes | URLs and browser history can contain them. The application does not store them in localStorage. |
| Appearance preferences | Browser storage, when available. Preferences do not contain shared text or files. |

Default retention is 15 minutes for files and 24 hours from session creation for sessions. Activity does not extend the session lifetime. Access checks reject expired content before the 30-second janitor removes it. A download that already has the file open can finish after expiry.

Each process creates a private spool directory with mode `0700`. Uploads use opaque filenames and mode `0600`. A persistent spool does not preserve usable sessions across a restart because the session index is held in memory. An abnormal exit can leave abandoned files on a persistent filesystem; remove those directories only while the service is stopped.

Deletion releases application resources but does not provide forensic erasure. Host swap and crash dumps can retain memory or tmpfs contents. Configure host storage and diagnostic collection to match the deployment's retention requirements.

## Browser and participant privacy

Sensitive responses use `Cache-Control: no-store`. Static browser assets are served by the application. Generated backgrounds use content-based filenames with immutable caching; the original photographs and logo are not served. Image generation removes source metadata.

The app does not register a service worker or keep an offline content cache. Installation uses a fixed home page URL without a session code. Proxy logs, browser history and diagnostic captures remain separate places where session URLs can appear.

Page titles, descriptions and social previews describe the application without shared content or session codes. Canonical URLs point to the configured public root. Installation screenshots contain only the public landing page. See [browser installation](PWA.md) for platform behavior and the distinction between Android installation warnings and application data handling.

Participant details are disabled by default. When enabled, observed IP addresses, user-agent data and client-supplied device details become visible to everyone in the session. Those details do not establish identity. A configured GeoIP provider receives participant IP addresses for location lookup.

QR codes are generated in the browser from the current session URL. They grant the same access as the session link and contain no additional tracking parameters. The application sends no session link to a third-party QR service.

File previews fetch uploads through the existing session access boundary with caching disabled. Downloads retain attachment disposition and `application/octet-stream`. Preview code interprets supported file extensions locally. HTML and SVG are displayed as source text; PDFs are rendered to canvas without document scripts, forms or embedded web pages. Preview byte limits and PDF canvas limits bound browser resource use. Unsupported formats and larger files remain downloadable. Browser previews do not prevent participants from retaining copies or screenshots.

The manual update check sends a server request to the fixed public GitHub tags endpoint. It does not forward session data or browser credentials. See [update check behavior](RELEASES.md#update-check-behavior) for request limits and caching.

## Synchronization and availability

Text synchronization accepts the most recent server write. It does not merge concurrent edits or retain revision history. Disconnected editors are read-only until the server snapshot arrives. Unacknowledged local text requires explicit recovery.

The session also owns its syntax language selection. The server validates an allowlist of supported modes, broadcasts accepted changes in order and includes the current mode in join and reconnect snapshots. Language updates do not alter text revisions. Disconnected browsers disable the selector and receive the server value after reconnecting.

Upload reservations account for files in progress. Application quotas also limit stored text, session count, connected peers and queued messages. These limits do not replace host memory and CPU limits or proxy request controls. A health response confirms HTTP availability, not spare upload capacity or end-to-end synchronization.

## Regression coverage

The following suites exercise the documented boundaries. Run them through [Contributing](../CONTRIBUTING.md#verification) and [candidate validation](DEPLOYMENT.md#validate-a-candidate), using disposable instances.

| Boundary | Coverage | Test source |
| --- | --- | --- |
| Configuration | Invalid values, limit validation and privacy defaults. | [Configuration tests](../internal/config/config_test.go) |
| Storage and expiry | Concurrent reservations, global budgets, cleanup and access after expiry. | [Session tests](../internal/session/session_test.go) |
| HTTP and WebSocket | Origin checks, cache headers, upload cleanup and participant metadata. | [Server tests](../internal/server/server_test.go) |
| Updates | Numeric version order, pagination limits, concurrent caching and upstream failures. | [Release tests](../internal/release/release_test.go) |
| Embedded assets | Source image exclusion, installation metadata and icon availability. | [Embedding tests](../web/embed_test.go) |
| Image builds | Source preservation, metadata removal, image bounds and icon dimensions. | [Background tests](../scripts/build-backgrounds.test.mjs), [logo tests](../scripts/build-logo.test.mjs) |
| Browser state | Synchronization, reconnect recovery, undo isolation, themes and installation. | [Browser tests](../tests/browser/) |
| Container runtime | User, filesystem, capabilities, limits, expiry and restart behavior. | [Container smoke test](../scripts/smoke-container.mjs) |

Dependency scans report known advisories at the time of the scan. Review toolchain versions, dependency lockfiles and base-image digests when preparing a release.
