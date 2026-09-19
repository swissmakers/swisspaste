# Configuration reference

[README](../README.md) | [Deployment](DEPLOYMENT.md) | [Security and data retention](REVIEW.md)

swissPaste reads environment variables at startup. Change the environment in your deployment definition, then recreate the Compose container or reload and restart the Quadlet service. Restarting an existing Compose container does not apply changes to `compose.yml`.

The tables below show application defaults. The supplied [Compose](../compose.yml) and [Quadlet](../swisspaste.container) definitions override the per-session file budget to `4GiB` and publish the container's port 8080 at `127.0.0.1:3002`. The standalone binary listens on all interfaces unless `SWISSPASTE_LISTEN` is set explicitly.

Compose provides local browser access. The system Quadlet configures `https://paste.swissmakers.ch` as the allowed browser origin for the public instance. Its reverse proxy terminates TLS. Forwarded headers remain untrusted by default, and participant details remain disabled.

## Network and TLS

| Variable | Default | Description |
| --- | --- | --- |
| `SWISSPASTE_LISTEN` | `:8080` | HTTP listen address. Use `127.0.0.1:8080` for a native process restricted to loopback. |
| `SWISSPASTE_PUBLIC_URL` | Empty | Public HTTP or HTTPS origin for canonical and social preview URLs. Empty omits these absolute URLs. The supplied Quadlet sets `https://paste.swissmakers.ch`. |
| `SWISSPASTE_ALLOWED_ORIGINS` | Empty | Comma-separated HTTP or HTTPS origins permitted for WebSocket connections and HTTP mutations. Empty requires the request's scheme and host to match. |
| `SWISSPASTE_TRUST_PROXY` | `false` | Trust `X-Forwarded-Proto` for the request scheme and `X-Forwarded-For` or `X-Real-IP` for the client address. |
| `SWISSPASTE_TLS_CERT` | Empty | Certificate file for built-in HTTPS. Requires `SWISSPASTE_TLS_KEY`. |
| `SWISSPASTE_TLS_KEY` | Empty | Private key file for built-in HTTPS. Requires `SWISSPASTE_TLS_CERT`. |

Origins must include the scheme and hostname, with a port when needed, such as `https://paste.example.ch`. Paths, trailing slashes, credentials, query strings and fragments are not accepted. An origin allowlist is not authentication.

The public URL accepts an optional trailing slash, which is removed at startup. Other paths, credentials, query strings and fragments are rejected. Set the public HTTPS origin used by participants. This setting controls metadata only and does not alter listeners, origin checks or proxy trust. Metadata never derives its hostname or session path from request headers.

Enable trusted proxy headers only when requests reach the application through a trusted proxy that overwrites incoming forwarding headers. For proxy TLS termination, use the [reverse proxy procedure](DEPLOYMENT.md#configure-a-reverse-proxy). For built-in HTTPS, both files must be readable by the application user. The server accepts TLS 1.2 or later.

## Storage and resource limits

| Variable | Default | Description |
| --- | --- | --- |
| `SWISSPASTE_DATA_DIR` | `/var/lib/swisspaste/spool` | Parent for a private, per-process spool directory with mode `0700`. Uploaded files use mode `0600`. |
| `SWISSPASTE_MAX_UPLOAD_BYTES` | `2GiB` | Maximum size of one uploaded file. |
| `SWISSPASTE_MAX_FILES` | `100` | Maximum files per session, including slots reserved for uploads in progress. |
| `SWISSPASTE_MAX_SESSION_BYTES` | `16GiB` | File budget per session. The supplied deployment sets `4GiB`. |
| `SWISSPASTE_MAX_TOTAL_BYTES` | `4GiB` | File budget across all sessions, including upload reservations. |
| `SWISSPASTE_MAX_TEXT_BYTES` | `4MiB` | Maximum UTF-8 document size per session. Values above `64MiB` are rejected. |
| `SWISSPASTE_MAX_TOTAL_TEXT_BYTES` | `256MiB` | Stored document budget across all sessions. |
| `SWISSPASTE_MAX_SESSIONS` | `256` | Maximum sessions held by the process. |
| `SWISSPASTE_MAX_PEERS` | `32` | Maximum connected participants per session. |

All applicable limits must permit an upload. Increasing a per-session limit does not increase the global budget. An upload with an unknown length reserves the full per-file allowance until completion. Failed uploads release their reservations.

Byte limits accept positive integers, either in bytes or with a case-sensitive `KiB`, `MiB` or `GiB` suffix. Fractional values, zero, negative values and integer overflow are rejected at startup. Count limits accept positive integers.

The file budget limits application data, not total process or container memory. With tmpfs, allow memory for the spool, document buffers, WebSocket queues and runtime overhead. The supplied deployment sets neither a container memory limit nor a CPU limit. Size those limits for the workload and keep the spool capacity aligned with the global file budget.

## Retention

| Variable | Default | Description |
| --- | --- | --- |
| `SWISSPASTE_FILE_TTL` | `15m` | File lifetime measured from upload. Session expiry can end access sooner. |
| `SWISSPASTE_SESSION_TTL` | `24h` | Session lifetime measured from creation. Activity does not extend it. |

Durations use Go syntax, such as `30s`, `15m` or `24h`. Values must be positive. Access checks reject expired content immediately. A janitor removes expired files and sessions every 30 seconds. An already open download can finish after expiry.

All session state is held in memory. Persistent file storage does not make sessions survive a restart. See [data retention](REVIEW.md#data-retention) for cleanup and storage limitations.

## Participant details

| Variable | Default | Description |
| --- | --- | --- |
| `SWISSPASTE_PEER_INSIGHTS` | `false` | Share observed IP addresses, user-agent information and client-supplied device details with session participants. |
| `SWISSPASTE_GEOIP_URL` | Empty | Optional HTTP or HTTPS JSON endpoint for IP location lookup. The address replaces `{ip}`, or is appended to the endpoint path. |

With participant details disabled, the interface exposes only a connected device count and no GeoIP requests are made. Enabling details makes them visible to everyone holding the session code. Client-supplied information does not establish identity.

GeoIP lookup requires both participant details and a configured endpoint. The provider receives the participant IP address. Private and loopback addresses are not queried. The accepted JSON fields are defined in the [GeoIP resolver](../internal/geoip/geoip.go).

## Fixed limits

These safeguards are defined in the server and cannot be changed through environment variables.

| Resource | Limit |
| --- | --- |
| Concurrent uploads | 8 per process |
| WebSocket connections | 256 per process |
| Queued WebSocket payloads | 128 MiB per process |
| Session creation | 60 per minute per process |
| Incoming WebSocket messages | 30 per second per connection |
| HTTP read and write timeouts | 30 minutes |

The browser obtains the version, sharing limits and retention settings from `/api/config`. This endpoint is a public subset of configuration, not a dump of the process environment.
