# Contributing to swissPaste

[README](README.md) | [Deployment](docs/DEPLOYMENT.md) | [Asset management](docs/ASSETS.md)

This guide covers local builds, verification and contribution rules for the Go server, browser interface and deployment files. The rules apply to human-authored and AI-assisted changes. Do not create commits, tags or pushes without an explicit maintainer instruction for that action.

## Build and run locally

**Prerequisites**

- Go 1.27.1, as specified in [go.mod](go.mod).
- Node.js 24.21.0 with npm, matching the asset stage in [Containerfile](Containerfile).
- Network access to fetch Go modules and pinned npm dependencies.
- Port 8080 available on loopback.

Run commands from the repository root. The container build includes these toolchains if you use the [Podman quick start](README.md#quick-start) instead.

**Procedure**

1. Install the exact npm dependencies recorded in the lockfile.

   ```bash
   npm ci
   ```

2. Generate the editor bundle, dependency notices, background variants and application icons.

   ```bash
   npm run build
   ```

3. Build the Go executable with its embedded assets. The output is `./swisspaste`.

   ```bash
   go build -o swisspaste .
   ```

4. Start the server with a temporary spool parent and a loopback listener. The process stays in the foreground and logs to standard output. Uploads use the temporary directory's filesystem, which might be disk-backed.

   ```bash
   SWISSPASTE_DATA_DIR="$(mktemp -d -t swisspaste-dev.XXXXXX)" SWISSPASTE_LISTEN=127.0.0.1:8080 ./swisspaste
   ```

5. Open [swissPaste](http://127.0.0.1:8080) and create a test session.

Stop the process with `Ctrl+C`. A graceful shutdown removes its private spool and discards all sessions. Changes to embedded assets require a new build and process restart.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `main.go` | Startup, embedded version and license, shutdown. |
| `internal/config/` | Environment validation and defaults. |
| `internal/session/` | Sessions, resource reservations and content lifetimes. |
| `internal/server/` | HTTP routes, WebSocket transport and security headers. |
| `internal/release/` | Cached GitHub tag checks. |
| `internal/geoip/` | Optional participant location lookup. |
| `web/` | Browser source, templates and generated assets. |
| `scripts/` | Asset builds and isolated container validation. |
| `tests/browser/` | Browser regression tests. |
| `docs/` | Operator and maintainer guides. |

## Source headers

Use these four lines at the top of authored source files, with the comment syntax appropriate to the file format:

```text
// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste
```

Add a one-to-three-line file description after the header. Use the package documentation comment on a Go package's main file. Generated assets, lockfiles, third-party notices, `VERSION` and formats that do not support leading comments are exempt. Preserve existing third-party attribution and machine directives.

## Comments

- Explain a constraint, invariant, unit or wire contract that the code does not express. Do not narrate the code.
- Keep comments inside functions to one line, symbol documentation to two lines and file descriptions to three lines.
- End sentences with a period except the last sentence in a comment.
- Do not use colons or semicolons as prose punctuation. Preserve colons in URLs, header fields and literal technical values.
- Do not use parentheses, brackets, trailing inline comments or a spaced hyphen as a connector.
- Describe current behavior. Do not record change history, personal preferences or speculative TODO narratives.
- Keep symbol documentation informative rather than repeating the symbol name.
- Preserve `//go:*`, shebangs and other machine-significant directives.

## Implementation

1. Search for existing implementations and callers before adding or changing a function.
2. Update internal callers directly when changing a signature.
3. Introduce a shared abstraction only when it serves an existing responsibility.
4. Preserve an external protocol only where a supported contract requires it.
5. Keep originals in `web/static/img/bg_source/` and `web/static/img/logo/logo.png` unchanged and regenerate derivative assets through the build.

## Typography and interface text

- Use ASCII punctuation in source, documentation and UI strings. Use straight quotes, hyphens and three periods instead of typographic variants.
- Keep accented letters in translated words and in the author name. Use SVG for icons.
- Use sentence case for labels, headings, buttons and badges. Preserve proper nouns and established abbreviations.
- End full sentences with a period. Labels and fragments do not need one.
- Express failures as "Could not ...". Do not use "Please", "Failed to" or "Unable to".
- Use a colon only before a label's value or inside literal technical text. Do not use semicolons or spaced slashes and hyphens as connectors.
- Keep the German interface informal and use Swiss spelling with `ss`. Keep natural developer terms such as Session, Update and Download.
- Use a separate translation key for each grammatical role. Keep references to other interface labels exact.
- Give hints a purpose, such as a limit, consequence or recovery action.

## Documentation

Write Markdown in the style of Red Hat product documentation. State the outcome, requirements and commands. Use present tense, active voice and direct instructions.

- Use numbered procedures with one action per step, starting with a verb.
- Use tables or lists for reference information.
- Explain each command block's prerequisites and expected result.
- Keep one paragraph per source line. Do not hard-wrap Markdown prose.
- Remove marketing, superlatives, hedging and transition-only sentences.
- Describe features as implemented. Identify remaining work separately.
- Apply normal sentence punctuation to documentation prose. The comment punctuation limits apply only to comments.

## Verification

**Prerequisites:** the local build environment above, a C compiler for Go race detection, installed npm dependencies and generated assets. Dependency scans also require network access. Run from the repository root. These checks use isolated test data.

1. Run the Go regression tests with race detection.

   ```bash
   go test -race ./...
   ```

2. Check Go code for common correctness errors.

   ```bash
   go vet ./...
   ```

3. Test image generation with temporary source files.

   ```bash
   npm run test:build
   ```

4. Scan reachable Go dependencies for known vulnerabilities. This command downloads the current scanner and advisory database.

   ```bash
   go run golang.org/x/vuln/cmd/govulncheck@latest ./...
   ```

5. Audit pinned npm dependencies against the npm advisory service.

   ```bash
   npm audit
   ```

6. Run the [isolated browser and container checks](docs/DEPLOYMENT.md#validate-a-candidate).

Each command must exit successfully. Resolve reported test failures, correctness errors and applicable dependency advisories before requesting review.

Add regression tests for durable behavior such as parsing, version ordering, access boundaries, quotas, recovery and privacy. Prefer table-driven Go tests. Do not add markup snapshots or tests that duplicate implementation details. Change assertions only when the intended rule changes. Never point the regression suite at a running deployment.
