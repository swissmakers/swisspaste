# Deployment and operations

[README](../README.md) | [Configuration](CONFIGURATION.md) | [Releases](RELEASES.md)

The supplied deployment exposes swissPaste on `127.0.0.1:3002`. It runs as user `65532:65532` with a read-only root filesystem, dropped capabilities, no-new-privileges and a tmpfs spool. Use the [quick start](../README.md#quick-start) for the first local deployment. Use the procedures below to validate and operate an existing instance.

Restarting or replacing the application discards all sessions and uploads. Schedule replacements when participants can tolerate that loss. An image rollback restores the application version but cannot restore session content.

Run Podman commands as the account that owns the deployment. Rootless and root-managed Podman use separate image and container stores. For a root-managed instance, use `sudo podman` consistently in the replacement, rollback and diagnostic commands, including `podman inspect` inside command substitutions.

## Validate a candidate

**Prerequisites**

- A working rootless Podman installation and network access for the build.
- The Node.js environment from [Contributing](../CONTRIBUTING.md#build-and-run-locally), with dependencies installed by `npm ci`.
- The Chromium system dependencies required by Playwright.
- Port 18080 and the container name `swisspaste-staging` available.

Run commands from the repository root. The browser suite expects a disposable instance with a 1 KiB per-file limit. Do not point it at the live service.

**Procedure**

1. Install Chromium for the browser suite. This downloads the browser required by the pinned Playwright version.

   ```bash
   npx playwright install chromium
   ```

2. Build the candidate image. The build uses pinned base images and generates the editor bundle, background variants and application icons.

   ```bash
   podman build --pull=always -t localhost/swisspaste-validated:candidate -f Containerfile .
   ```

3. Run the container smoke test. It creates a temporary container on a random loopback port, checks runtime hardening, limits, synchronization, expiry and restart cleanup, then removes its container. A successful run exits with status zero.

   ```bash
   node scripts/smoke-container.mjs localhost/swisspaste-validated:candidate
   ```

4. Start the browser-test container on `127.0.0.1:18080`. Podman prints its container ID.

   ```bash
   podman run --detach --name swisspaste-staging \
     --read-only --cap-drop=ALL --security-opt=no-new-privileges \
     --publish 127.0.0.1:18080:8080 \
     --tmpfs /var/lib/swisspaste/spool:rw,size=64m,mode=1777,nodev,nosuid,noexec \
     --env SWISSPASTE_MAX_UPLOAD_BYTES=1KiB \
     --env SWISSPASTE_MAX_TOTAL_BYTES=64MiB \
     localhost/swisspaste-validated:candidate
   ```

5. Verify that the test instance is ready. The endpoint returns `ok`.

   ```bash
   curl --fail http://127.0.0.1:18080/healthz
   ```

6. Run the browser suite against the test instance. All tests must pass.

   ```bash
   SWISSPASTE_TEST_URL=http://127.0.0.1:18080 npm test
   ```

7. Remove the test container after validation, including when a test fails. This removes only `swisspaste-staging`.

   ```bash
   podman rm --force swisspaste-staging
   ```

Keep the validated candidate image for deployment. Resolve failures before replacing the live instance.

## Replace a Compose instance

**Prerequisites:** a validated candidate in the running instance's Podman image store, a Compose provider and an agreed interruption of all sessions. Run from the repository root. If validation ran as a different account, [transfer the image](#transfer-a-rootless-image-to-a-root-managed-installation) first.

1. Preserve the running container's image under the rollback tag. This replaces any previous `rollback` tag, so retain an additional versioned tag if you need older images.

   ```bash
   podman tag "$(podman inspect --format '{{.Image}}' swisspaste)" localhost/swisspaste:rollback
   ```

2. Select the validated image as the Compose image.

   ```bash
   podman tag localhost/swisspaste-validated:candidate localhost/swisspaste:latest
   ```

3. Recreate the service from that image. This discards current sessions and files.

   ```bash
   podman compose up --detach --no-build --force-recreate swisspaste
   ```

4. Verify health. The endpoint returns `ok`.

   ```bash
   curl --fail http://127.0.0.1:3002/healthz
   ```

5. Verify the version and configured limits in the JSON response.

   ```bash
   curl --fail http://127.0.0.1:3002/api/config
   ```

6. Open the interface and check the footer, background and a new test session.

Retain the rollback image until you accept the replacement. Changing environment settings requires the same container recreation. A plain container restart does not apply an edited Compose file.

## Roll back a Compose instance

**Prerequisites:** the retained `localhost/swisspaste:rollback` image in the deployment account's store and an agreed session interruption. Run from the repository root. Restore any required configuration changes separately because the image does not contain the Compose configuration.

1. Select the previous image as the Compose image.

   ```bash
   podman tag localhost/swisspaste:rollback localhost/swisspaste:latest
   ```

2. Recreate the service from that image. Current sessions and uploads are discarded.

   ```bash
   podman compose up --detach --no-build --force-recreate swisspaste
   ```

3. Verify that the application responds with `ok`.

   ```bash
   curl --fail http://127.0.0.1:3002/healthz
   ```

4. Verify that the footer shows the restored version and that a new session can exchange text and files.

## Transfer a rootless image to a root-managed installation

**Prerequisites:** the validated candidate in your rootless image store, sudo access and enough space in `/tmp` for an image archive. These commands copy the image into root's store without changing the running service.

1. Export the validated candidate to an OCI archive.

   ```bash
   podman save --format oci-archive --output /tmp/swisspaste-candidate.oci.tar localhost/swisspaste-validated:candidate
   ```

2. Import the archive into the root-managed store. Podman reports the loaded image name.

   ```bash
   sudo podman load --input /tmp/swisspaste-candidate.oci.tar
   ```

## Configure startup after reboot

The Compose `on-failure:3` policy is not a systemd boot service. The supplied Quadlet uses a locally built image and does not enable automatic registry updates.

**Prerequisites:** systemd with Podman Quadlet support, sudo access, an image named `localhost/swisspaste:latest` in root's Podman store and port 3002 available. Stop and remove an existing Compose container before starting the Quadlet with the same container name or port. Run these commands from the repository root.

The supplied Quadlet runs as a system service and accepts the browser origin `https://paste.swissmakers.ch`. It uses the same public URL for canonical and social metadata. The existing HTTPS proxy forwards to `127.0.0.1:3002`. Change `SWISSPASTE_ALLOWED_ORIGINS` and `SWISSPASTE_PUBLIC_URL` in the Quadlet before installing it for a different hostname. The application process inside the container still runs as user `65532:65532`.

1. Create the system Quadlet directory.

   ```bash
   sudo install -d -m 0755 /etc/containers/systemd
   ```

2. Install the unit from the repository root.

   ```bash
   sudo install -m 0644 swisspaste.container /etc/containers/systemd/swisspaste.container
   ```

3. Reload the system service manager to generate the service and its boot dependency.

   ```bash
   sudo systemctl daemon-reload
   ```

4. Start the generated service.

   ```bash
   sudo systemctl start swisspaste.service
   ```

5. Verify the generated service. The output must report `active (running)`.

   ```bash
   sudo systemctl status swisspaste.service
   ```

6. Verify the boot dependency. The output must include `swisspaste.service` among the services required by `multi-user.target`.

   ```bash
   systemctl list-dependencies --plain multi-user.target
   ```

The Quadlet's `[Install]` section contains `WantedBy=multi-user.target`. The generator applies this during service generation. Do not run `systemctl enable` on the generated service. The service starts at boot and systemd restarts it if the container exits. An explicit service stop suppresses that restart. See the installed `podman-systemd.unit(5)` manual for the unit search paths and generation rules.

For a Quadlet update, use `sudo podman` to preserve the running image and tag the validated candidate as `localhost/swisspaste:latest`, as in the Compose replacement procedure. Then run `sudo systemctl restart swisspaste.service` and verify health and version. After changing the repository's Quadlet file, install it again and run `sudo systemctl daemon-reload` before the restart. To roll back, tag the retained rollback image as `localhost/swisspaste:latest` and restart the service. Both update paths interrupt active sessions. Once systemd manages the instance, use this procedure rather than Compose to replace it.

## Configure a reverse proxy

Keep the application on loopback and terminate HTTPS at the proxy. The proxy must support WebSocket upgrades. Restrict direct access before enabling trusted forwarded headers. Session codes are present in URLs, so disable or redact access logs for session routes.

For Apache, replace the application's `combined` access-log format with a minimal format such as `"%t %m %>s %B"`. It records the request time, method, final status and response size without addresses, URLs, referrers or user-agent strings. See [Apache log formats](https://httpd.apache.org/docs/2.4/mod/mod_log_config.html#formats). Validate the configuration before a graceful reload. This change affects new access entries only. Existing logs, global logs and error diagnostics require a separate retention review.

**Prerequisites:** a working nginx HTTPS virtual host on the application host, a certificate for the public hostname and the application reachable on `127.0.0.1:3002`. The example uses `paste.example.ch`; replace it with your hostname. Configure the deployment's access policy before making it public.

1. Set the application environment in your deployment definition. These values restrict accepted browser origins and allow the proxy to supply the request scheme and client address.

   ```text
   SWISSPASTE_ALLOWED_ORIGINS=https://paste.example.ch
   SWISSPASTE_PUBLIC_URL=https://paste.example.ch
   SWISSPASTE_TRUST_PROXY=true
   ```

2. Add the following location to that HTTPS virtual host. It forwards WebSocket upgrades, overwrites forwarding headers and disables access logging for the application. Align `client_max_body_size` with the configured per-file limit.

   ```nginx
   location / {
       access_log off;
       proxy_pass http://127.0.0.1:3002;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_request_buffering off;
       proxy_read_timeout 1800s;
       proxy_send_timeout 1800s;
       client_max_body_size 2g;
   }
   ```

3. Apply the application environment through the Compose replacement or Quadlet restart procedure above.
4. Validate the nginx configuration. The command must report a successful syntax and configuration check.

   ```bash
   sudo nginx -t
   ```

5. Reload nginx through systemd. The service applies the validated configuration.

   ```bash
   sudo systemctl reload nginx
   ```

6. Open the public HTTPS URL in two browsers and verify text synchronization and a file upload.

The example disables the application access log, but error logs and any upstream proxies can still record request URLs. Review those logging paths as well. If nginx runs in another container or on another host, its loopback address does not reach this application; configure a private network path before adapting this example.

## Inspect a running instance

**Prerequisites:** access to the deployment account's Podman store and the running `swisspaste` container. These commands read state without creating sessions.

| Task | Command | Expected result |
| --- | --- | --- |
| Check HTTP health | `curl --fail http://127.0.0.1:3002/healthz` | `ok` while the HTTP service is available. |
| Check version and sharing limits | `curl --fail http://127.0.0.1:3002/api/config` | JSON describing the running build and public limits. |
| Check published ports | `podman port swisspaste` | Container port 8080 published at `127.0.0.1:3002`. |
| Read recent application logs | `podman logs --tail 100 swisspaste` | JSON startup, shutdown or error messages. |

For the system Quadlet service, use `sudo journalctl -u swisspaste.service -n 100 --no-pager` to read recent service and container messages. `/healthz` confirms an HTTP response; it does not test browser synchronization, available spool capacity or GitHub connectivity.

## Operational limits

| Area | Requirement |
| --- | --- |
| Memory | Size container and host budgets for text, queued messages and the tmpfs spool. |
| Swap | Disable or encrypt swap if persistence of memory contents is unacceptable. |
| File storage | Keep tmpfs capacity aligned with global and session upload budgets. |
| Persistent spool | Remove abandoned private spool directories only while the service is stopped. |
| Proxy | Apply authentication and request limits appropriate to the deployment. |
| Logs | Prevent session codes and content from entering proxy or diagnostic logs. |
| Updates | Rebuild and validate before replacement. The footer check never installs software. |
| Source | Keep the corresponding source for the deployed build available through the footer link. |
