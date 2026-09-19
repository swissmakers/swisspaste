// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Validate an isolated container and remove its temporary resources
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const image = process.argv[2];
if (!image) throw new Error("Usage: node scripts/smoke-container.mjs IMAGE");
const name = `swisspaste-smoke-${process.pid}`;
const podman = (...args) =>
  execFileSync("podman", args, { encoding: "utf8", timeout: 60000 }).trim();
let started = false;
const sockets = [];

async function eventually(check, milliseconds = 10000) {
  const deadline = Date.now() + milliseconds;
  do {
    if (await check()) return;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for container behavior");
}

function connect(base, code) {
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}/ws/${code}`);
  sockets.push(socket);
  const messages = [];
  socket.addEventListener("message", (event) =>
    messages.push(JSON.parse(event.data)),
  );
  return {
    socket,
    async next(type) {
      let result;
      await eventually(() => {
        const index = messages.findIndex((message) => message.type === type);
        if (index < 0) return false;
        result = messages.splice(index, 1)[0];
        return true;
      });
      return result;
    },
  };
}

try {
  podman(
    "run",
    "--detach",
    "--name",
    name,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--publish",
    "127.0.0.1::8080",
    "--tmpfs",
    "/var/lib/swisspaste/spool:rw,size=16m,mode=1777,nodev,nosuid,noexec",
    "--env",
    "SWISSPASTE_MAX_UPLOAD_BYTES=1KiB",
    "--env",
    "SWISSPASTE_MAX_SESSION_BYTES=4KiB",
    "--env",
    "SWISSPASTE_MAX_TOTAL_BYTES=16MiB",
    "--env",
    "SWISSPASTE_FILE_TTL=2s",
    "--env",
    "SWISSPASTE_SESSION_TTL=8s",
    image,
  );
  started = true;
  const info = JSON.parse(podman("inspect", name))[0];
  assert.equal(info.Config.User, "65532:65532");
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.ok(
    info.HostConfig.SecurityOpt.some((value) =>
      value.startsWith("no-new-privileges"),
    ),
  );
  assert.ok(
    info.HostConfig.Tmpfs["/var/lib/swisspaste/spool"].includes("noexec"),
  );
  const binding = info.NetworkSettings.Ports["8080/tcp"][0];
  assert.equal(binding.HostIp, "127.0.0.1");
  const base = `http://127.0.0.1:${binding.HostPort}`;
  const request = (path, options = {}) =>
    fetch(base + path, { signal: AbortSignal.timeout(5000), ...options });
  const healthy = () =>
    request("/healthz")
      .then((response) => response.ok)
      .catch(() => false);
  await eventually(healthy);

  const configResponse = await request("/api/config");
  assert.equal(configResponse.headers.get("cache-control"), "no-store");
  assert.equal(configResponse.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    configResponse.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  const config = await configResponse.json();
  assert.equal(config.peerInsights, false);
  assert.equal(config.maxUploadBytes, 1024);
  assert.equal(config.fileTtlMs, 2000);
  assert.equal(config.sessionTtlMs, 8000);
  assert.equal(
    (
      await request("/api/sessions", {
        method: "POST",
        headers: { Origin: "https://cross-site.invalid" },
      })
    ).status,
    403,
  );
  console.log(
    "PASS: hardened runtime, configured limits, privacy and origin protection",
  );

  const create = async () => {
    const response = await request("/api/sessions", { method: "POST" });
    assert.equal(response.status, 201);
    return response.json();
  };
  const session = await create();
  const path = `/api/sessions/${session.code}`;
  const first = connect(base, session.code),
    second = connect(base, session.code);
  assert.equal((await first.next("init")).roster, undefined);
  await second.next("init");
  first.socket.send(
    JSON.stringify({ type: "text", content: "container smoke test" }),
  );
  assert.equal((await first.next("ack")).content, "container smoke test");
  assert.equal((await second.next("text")).content, "container smoke test");
  const upload = (body) =>
    request(`${path}/files`, {
      method: "POST",
      headers: {
        "X-Filename": "smoke%2Btest.txt",
        "Content-Type": "application/octet-stream",
      },
      body,
    });
  assert.equal((await upload(Buffer.alloc(1025))).status, 413);
  const uploaded = await upload("smoke file");
  assert.equal(uploaded.status, 201);
  const file = await uploaded.json();
  const download = await request(`${path}/files/${file.id}`);
  assert.equal(await download.text(), "smoke file");
  assert.equal(download.headers.get("cache-control"), "no-store");
  await eventually(
    async () => (await request(`${path}/files/${file.id}`)).status === 404,
    4000,
  );
  await eventually(async () => (await request(path)).status === 404, 10000);
  first.socket.send(
    JSON.stringify({ type: "text", content: "rejected after expiry" }),
  );
  await eventually(() => first.socket.readyState === WebSocket.CLOSED);
  second.socket.close();
  console.log(
    "PASS: two-client sync, upload/download limits, file expiry and session expiry",
  );

  const beforeRestart = await create();
  const beforePath = `/api/sessions/${beforeRestart.code}`;
  assert.equal(
    (
      await request(`${beforePath}/files`, {
        method: "POST",
        body: "temporary file",
      })
    ).status,
    201,
  );
  podman("restart", "--time", "5", name);
  await eventually(healthy);
  assert.equal((await request(beforePath)).status, 404);
  await create();
  console.log("PASS: restart drops previous sessions and accepts new work");
} finally {
  for (const socket of sockets) socket.close();
  if (started) podman("rm", "--force", name);
}
