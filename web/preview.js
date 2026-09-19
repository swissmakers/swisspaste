// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Render untrusted uploads locally without executing uploaded markup
const textModes = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  json: "application/json",
  html: "htmlmixed",
  htm: "htmlmixed",
  css: "css",
  xml: "xml",
  svg: "xml",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  go: "text/x-go",
  rs: "rust",
  php: "text/x-php",
  java: "text/x-java",
  c: "text/x-csrc",
  h: "text/x-csrc",
  cpp: "text/x-c++src",
  cc: "text/x-c++src",
  hpp: "text/x-c++src",
  cs: "text/x-csharp",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yaml: "yaml",
  yml: "yaml",
  sql: "text/x-sql",
  ini: "text/x-properties",
  properties: "text/x-properties",
  conf: "text/x-properties",
  env: "shell",
  ps1: "powershell",
  diff: "diff",
  patch: "diff",
  rb: "ruby",
  pl: "perl",
  lua: "lua",
  toml: "toml",
  txt: "",
  log: "",
  csv: "",
  tsv: "",
  rst: "",
};
const mediaTypes = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
};

function fileKind(name) {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop();
  if (ext === "pdf") return { type: "pdf", limit: 32 * 1024 * 1024 };
  if (Object.hasOwn(mediaTypes, ext))
    return { type: mediaTypes[ext], limit: 32 * 1024 * 1024 };
  let mode = textModes[ext];
  if (/^(dockerfile|containerfile)(\.|$)/.test(lower)) mode = "dockerfile";
  if (lower === "nginx.conf") mode = "nginx";
  if (
    /^(readme|license|copying|makefile|\.gitignore|\.editorconfig)$/.test(lower)
  )
    mode = "";
  if (mode !== undefined) return { type: "text", mode, limit: 1024 * 1024 };
  return null;
}

export async function renderPreview(host, file, url, signal, t) {
  let objectURL, editor, loadingTask, renderTask, media;
  function dispose() {
    if (media) {
      media.pause?.();
      media.removeAttribute("src");
      media.load?.();
    }
    if (objectURL) URL.revokeObjectURL(objectURL);
    editor?.destroy();
    renderTask?.cancel();
    loadingTask?.destroy().catch(() => {});
    host.replaceChildren();
    host.setAttribute("aria-busy", "false");
  }
  if (signal.aborted) return;
  signal.addEventListener("abort", dispose, { once: true });
  function message(key) {
    if (signal.aborted) return;
    const paragraph = document.createElement("p");
    paragraph.className = "preview-message";
    paragraph.setAttribute("role", "status");
    paragraph.textContent = t(key);
    host.replaceChildren(paragraph);
    host.setAttribute("aria-busy", "false");
  }
  const kind = fileKind(file.name);
  if (!kind) return message("previewUnsupported");
  if (file.size > kind.limit) return message("previewTooLarge");
  try {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (response.status === 404) return message("previewGone");
    if (!response.ok) throw new Error("Could not read file");
    // Bound bytes independently of advertised file metadata
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > kind.limit) {
        await reader.cancel();
        return message("previewTooLarge");
      }
      chunks.push(value);
    }
    if (signal.aborted) return;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (kind.type === "text") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/[\x00-\x08\x0e-\x1f]/.test(text))
        return message("previewUnsupported");
      const container = document.createElement("div");
      container.className = "editor-host preview-editor";
      host.replaceChildren(container);
      editor = window.SwissEditor(container, () => {});
      editor.setLabel(t("preview") + ": " + file.name);
      editor.setLanguage(kind.mode);
      editor.setValue(text);
    } else if (kind.type === "pdf") {
      const { getDocument } = await import("/static/pdf.bundle.js");
      if (signal.aborted) return;
      const toolbar = document.createElement("div");
      toolbar.className = "pdf-toolbar";
      const previous = document.createElement("button"),
        next = document.createElement("button");
      const label = document.createElement("span");
      label.setAttribute("role", "status");
      for (const [button, key] of [
        [previous, "previousPage"],
        [next, "nextPage"],
      ]) {
        button.type = "button";
        button.className = "ghostbtn";
        button.textContent = t(key);
      }
      toolbar.append(previous, label, next);
      const paper = document.createElement("div");
      paper.className = "pdf-paper";
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      paper.append(canvas);
      host.replaceChildren(toolbar, paper);
      previous.disabled = next.disabled = true;
      loadingTask = getDocument({
        data: bytes,
        isEvalSupported: false,
        useWasm: false,
        enableXfa: false,
        maxImageSize: 16 * 1024 * 1024,
        canvasMaxAreaInBytes: 32 * 1024 * 1024,
        cMapUrl: "/static/pdf/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/static/pdf/standard_fonts/",
      });
      const pdf = await loadingTask.promise;
      if (signal.aborted) return;
      let pageNumber = 1;
      async function draw(number) {
        previous.disabled = next.disabled = true;
        host.setAttribute("aria-busy", "true");
        try {
          const page = await pdf.getPage(number);
          if (signal.aborted) return;
          const original = page.getViewport({ scale: 1 });
          const width = Math.max(160, paper.clientWidth - 32);
          const scale = Math.min(width / original.width, 2);
          const ratio = Math.min(devicePixelRatio || 1, 2);
          const pixelScale = Math.min(
            scale * ratio,
            Math.sqrt(8000000 / (original.width * original.height)),
          );
          const viewport = page.getViewport({ scale: pixelScale });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = Math.ceil(original.width * scale) + "px";
          canvas.style.height = "auto";
          canvas.setAttribute(
            "aria-label",
            t("page") + " " + number + " / " + pdf.numPages,
          );
          renderTask = page.render({
            canvasContext: canvas.getContext("2d"),
            viewport,
          });
          await renderTask.promise;
          if (signal.aborted) return;
          renderTask = null;
          pageNumber = number;
          label.textContent = t("page") + " " + number + " / " + pdf.numPages;
          previous.disabled = number === 1;
          next.disabled = number === pdf.numPages;
          paper.scrollTop = 0;
          page.cleanup();
          host.setAttribute("aria-busy", "false");
        } catch (error) {
          if (!signal.aborted) message("previewFailed");
        }
      }
      previous.addEventListener("click", () => draw(pageNumber - 1));
      next.addEventListener("click", () => draw(pageNumber + 1));
      await draw(1);
    } else {
      objectURL = URL.createObjectURL(new Blob([bytes], { type: kind.type }));
      media = document.createElement(
        kind.type.startsWith("image/") ? "img" : kind.type.split("/")[0],
      );
      media.className = "preview-media";
      media.setAttribute("aria-label", file.name);
      if (media.tagName === "IMG") media.alt = file.name;
      else {
        media.controls = true;
        media.preload = "metadata";
      }
      media.addEventListener("error", () => message("previewFailed"), {
        once: true,
      });
      media.src = objectURL;
      host.replaceChildren(media);
    }
    if (!signal.aborted) host.setAttribute("aria-busy", "false");
  } catch (error) {
    if (!signal.aborted) message("previewFailed");
  }
}
