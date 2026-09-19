// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Manage shared sessions and the bilingual browser interface
(function () {
  "use strict";

  var ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  var CODE_LEN = 16;
  var GROUP = 4;
  var SEND_DEBOUNCE_MS = 120;
  var LS = {
    THEME: "swisspaste:theme",
    LANG: "swisspaste:lang",
    LAST: "swisspaste:lastCode",
  };

  // Preferences may be unavailable in private or restricted browser contexts
  var storage = {
    getItem: function (key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    setItem: function (key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {}
    },
    removeItem: function (key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    },
  };
  var limits = null;
  var live = false;
  var dirtyText = null;
  var sentTexts = [];
  var reconnectTimer = null;
  var syncError = null;
  var recoveryText = null;
  var I18N = {
    de: {
      sharedClipboard: "Gemeinsame Zwischenablage",
      alreadyHaveCode: "Du hast bereits einen Code?",
      devices: "Geräte",
      device: "Gerät",
      timeLeft: "Verbleibend",
      textTab: "Text",
      sessionContents: "Session-Inhalte",
      pageTitle: "swissPaste - Text und Dateien teilen",
      pageDescription:
        "Text und Dateien zwischen deinen Geräten teilen. Eine gemeinsame Session im Browser, ohne Anmeldung.",
      projectLinks: "Projekt",
      sourceCode: "Quellcode",
      checkUpdates: "Updates prüfen",
      updatePrivacy:
        "Fragt öffentliche GitHub-Tags ab. Keine Session-Inhalte werden übermittelt.",
      checkingUpdates: "Updates werden geprüft...",
      updateAvailable: "Neue Version verfügbar:",
      updateCurrent: "Du verwendest die aktuelle Version.",
      updateUnreleased: "Noch keine stabilen Versionen veröffentlicht.",
      updateUnavailable:
        "Updates konnten nicht geprüft werden. Versuche es später erneut.",
      viewTag: "Version ansehen",
      copyText: "Text kopieren",
      copyLink: "Link kopieren",
      textCopied: "Text kopiert",
      linkCopied: "Link kopiert",
      editorLabel: "Gemeinsamer Text",
      saved: "Synchronisiert",
      saving: "Wird synchronisiert ...",
      networkError: "Verbindung fehlgeschlagen. Bitte erneut versuchen.",
      createFail:
        "Session konnte nicht erstellt werden. Später erneut versuchen.",
      leaveUnsynced:
        "Verlassen und nicht synchronisierten Text oder laufende Uploads verwerfen?",
      deleteFail: "Datei konnte nicht entfernt werden.",
      cancel: "Abbrechen",
      draftNotice:
        "Nicht synchronisierter Text wurde gesichert. Vor dem Ersetzen des gemeinsamen Textes prüfen.",
      restoreDraft: "Gesicherten Text wiederherstellen",
      discardDraft: "Verwerfen",
      textTooLarge: "Text überschreitet das Limit: ",
      serverBusy: "Server ausgelastet. Später erneut versuchen.",
      copyFailedHint:
        "Kopieren fehlgeschlagen. Text markieren und manuell kopieren.",
      useLightTheme: "Helles Design verwenden",
      useDarkTheme: "Dunkles Design verwenden",
      installApp: "App installieren",
      installHint:
        "Für gemeinsame Sessions brauchst du eine Verbindung zum Server.",
      installFailed:
        "Die Installation konnte nicht gestartet werden. Verwende das Browsermenü.",
      privacyOn:
        "Deine IP-Adresse und Geräteinformationen sind für alle in dieser Session sichtbar.",
      privacyOff: "Es wird nur die Anzahl verbundener Geräte geteilt.",
      accessNotice:
        "Jeder mit diesem Code kann alle Inhalte lesen, ändern und Dateien löschen. Nur mit vertrauten Personen teilen.",
      fileLimit: "Pro Datei: ",
      retention: "Aufbewahrung: ",
      sessionDuration: "Die Session endet automatisch nach ",
      confirmDelete: "Datei für alle Teilnehmer entfernen?",
      session: "Session",
      showQR: "QR-Code anzeigen",
      qrTitle: "Session auf einem anderen Gerät öffnen",
      qrHint: "Scanne den QR-Code mit der Kamera deines Smartphones.",
      qrFailed:
        "QR-Code konnte nicht erstellt werden. Kopiere stattdessen den Link.",
      close: "Schliessen",
      preview: "Vorschau",
      previewLoading: "Vorschau wird geladen...",
      previewUnsupported:
        "Für dieses Format ist keine Vorschau verfügbar. Du kannst die Datei herunterladen.",
      previewTooLarge:
        "Diese Datei ist für die Vorschau zu gross. Du kannst sie herunterladen.",
      previewFailed:
        "Vorschau konnte nicht geladen werden. Versuche es erneut oder lade die Datei herunter.",
      previewGone: "Diese Datei wurde gelöscht oder ist abgelaufen.",
      previousPage: "Vorherige Seite",
      nextPage: "Nächste Seite",
      page: "Seite",
      languageFailed: "Sprache konnte nicht synchronisiert werden.",
      leave: "Verlassen",
      title: "Text und Dateien teilen",
      intro:
        "Erstelle eine Session und öffne ihren Link auf einem anderen Gerät. Ohne Anmeldung.",
      newSession: "Session erstellen",
      joinLabel: "Session-Code",
      join: "Beitreten",
      howTitle: "So funktionierts",
      step1: "Erstelle eine Session oder gib einen vorhandenen Code ein.",
      step2: "Öffne den Link auf deinen anderen Geräten.",
      step3: "Teile Text und Dateien in derselben Session.",
      step4: "Session endet nach 24 Stunden automatisch.",
      securityTitle: "Datenschutz und Aufbewahrung",
      sec1t: "Text",
      sec1d:
        "Wird im Arbeitsspeicher des Servers gehalten. Ein Neustart beendet alle Sessions.",
      sec2t: "Dateien",
      sec2d: "Kurzzeitig im Spool. Löschung nach 15 Minuten.",
      sec3t: "Übertragung",
      sec3d:
        "Für vertrauliche Inhalte HTTPS verwenden. Keine Ende-zu-Ende-Verschlüsselung.",
      sec4t: "Zugriff",
      sec4d: "Jeder mit dem Code kann alle Inhalte lesen und ändern.",
      paste: "Text",
      language: "Sprache",
      files: "Dateien",
      drop: "Dateien auswählen oder hierher ziehen",
      noFiles: "Noch keine Dateien geteilt.",
      plaintext: "Klartext",
      copied: "Code kopiert",
      copyFail: "Kopieren nicht möglich",
      badCode: "Ungültiger Code.",
      notFound: "Diese Session existiert nicht (mehr).",
      expired: "Die Session ist abgelaufen.",
      gone: "Session beendet. Inhalt gelöscht.",
      connecting: "Verbinde ...",
      reconnecting: "Verbindung unterbrochen. Neuer Versuch ...",
      live: "Verbunden",
      uploadFail: "Upload fehlgeschlagen",
      tooMany: "Zu viele Dateien in dieser Session.",
      sessFull: "Speicherlimit der Session erreicht.",
      download: "Herunterladen",
      remove: "Entfernen",
      peersTitle: "Verbundene Geräte",
      uploading: "Wird hochgeladen ...",
      participants: "Teilnehmer",
      showParticipants: "Teilnehmer anzeigen",
      rosterNote:
        "IP-Adressen sind nur den Teilnehmern dieser Session sichtbar. Sie helfen, unbekannte Verbindungen zu erkennen.",
      you: "Du",
      anonPeer: "Teilnehmer",
      fIp: "IP-Adresse",
      fSystem: "System",
      fBrowser: "Browser",
      fDevice: "Gerät",
      fMobile: "Mobilgerät",
      fLocation: "Standort",
      fCoords: "Koordinaten",
      fTimezone: "Zeitzone",
      fLanguages: "Sprachen",
      fScreen: "Bildschirm",
      fPlatform: "Plattform",
      fJoined: "Beigetreten",
      fAgent: "User-Agent",
      selfReported: "selbst gemeldet",
      mapLink: "Auf Karte",
      yes: "Ja",
      unknownVal: "unbekannt",
    },
    en: {
      sharedClipboard: "Shared clipboard",
      alreadyHaveCode: "Already have a code?",
      devices: "devices",
      device: "device",
      timeLeft: "Time left",
      textTab: "Text",
      sessionContents: "Session content",
      pageTitle: "swissPaste - Share text and files",
      pageDescription:
        "Share text and files between your devices. A shared browser session, with no account needed.",
      projectLinks: "Project",
      sourceCode: "Source code",
      checkUpdates: "Check for updates",
      updatePrivacy: "Checks public GitHub tags. No session content is sent.",
      checkingUpdates: "Checking for updates...",
      updateAvailable: "New version available:",
      updateCurrent: "You are running the latest version.",
      updateUnreleased: "No stable versions have been published yet.",
      updateUnavailable: "Could not check for updates. Try again later.",
      viewTag: "View version",
      copyText: "Copy text",
      copyLink: "Copy link",
      textCopied: "Text copied",
      linkCopied: "Link copied",
      editorLabel: "Shared text",
      saved: "Synced",
      saving: "Syncing ...",
      networkError: "Could not connect. Try again.",
      createFail: "Could not create a session. Try again later.",
      leaveUnsynced: "Leave and discard unsynced text or pending uploads?",
      deleteFail: "Could not remove the file.",
      cancel: "Cancel",
      draftNotice:
        "Unsynced text was kept for recovery. Review it before replacing the shared text.",
      restoreDraft: "Restore recovered text",
      discardDraft: "Discard",
      textTooLarge: "Text exceeds the limit: ",
      serverBusy: "Server busy. Try again later.",
      copyFailedHint: "Could not copy. Select the text and copy it manually.",
      useLightTheme: "Use light theme",
      useDarkTheme: "Use dark theme",
      installApp: "Install app",
      installHint: "Shared sessions require a connection to the server.",
      installFailed: "Could not start installation. Use the browser menu.",
      privacyOn:
        "Your IP address and device details are visible to everyone in this session.",
      privacyOff: "Only the connected device count is shared.",
      accessNotice:
        "Anyone with this code can read and change all content and delete files. Share only with people you trust.",
      fileLimit: "Per file: ",
      retention: "Retention: ",
      sessionDuration: "The session ends automatically after ",
      confirmDelete: "Remove this file for everyone?",
      session: "Session",
      showQR: "Show QR code",
      qrTitle: "Open this session on another device",
      qrHint: "Scan the QR code with your smartphone camera.",
      qrFailed: "Could not create the QR code. Copy the link instead.",
      close: "Close",
      preview: "Preview",
      previewLoading: "Loading preview...",
      previewUnsupported:
        "No preview is available for this format. You can download the file.",
      previewTooLarge:
        "This file is too large to preview. You can download it.",
      previewFailed:
        "Could not load the preview. Try again or download the file.",
      previewGone: "This file was deleted or has expired.",
      previousPage: "Previous page",
      nextPage: "Next page",
      page: "Page",
      languageFailed: "Could not synchronize the language.",
      leave: "Leave",
      title: "Share text and files",
      intro:
        "Create a session and open its link on another device. No account needed.",
      newSession: "Create session",
      joinLabel: "Session code",
      join: "Join",
      howTitle: "How it works",
      step1: "Create a session or enter an existing code.",
      step2: "Open the link on your other devices.",
      step3: "Share text and files in the same session.",
      step4: "The session ends automatically after 24 hours.",
      securityTitle: "Privacy and retention",
      sec1t: "Text",
      sec1d: "Held in server memory. A restart ends all sessions.",
      sec2t: "Files",
      sec2d: "Stored briefly in the spool. Deleted after 15 minutes.",
      sec3t: "Transfer",
      sec3d:
        "Use HTTPS for sensitive content. Content is not end-to-end encrypted.",
      sec4t: "Access",
      sec4d: "Anyone with the code can read and change all content.",
      paste: "Text",
      language: "Language",
      files: "Files",
      drop: "Choose files or drop them here",
      noFiles: "No files shared yet.",
      plaintext: "Plain text",
      copied: "Code copied",
      copyFail: "Could not copy",
      badCode: "Invalid code.",
      notFound: "This session does not exist or has expired.",
      expired: "The session has expired.",
      gone: "Session ended. Content deleted.",
      connecting: "Connecting ...",
      reconnecting: "Connection lost. Retrying ...",
      live: "Connected",
      uploadFail: "Could not upload",
      tooMany: "Too many files in this session.",
      sessFull: "Session storage limit reached.",
      download: "Download",
      remove: "Remove",
      peersTitle: "Connected devices",
      uploading: "Uploading ...",
      participants: "Participants",
      showParticipants: "Show participants",
      rosterNote:
        "IP addresses are visible only to participants of this session. They help you spot unknown connections.",
      you: "You",
      anonPeer: "Participant",
      fIp: "IP address",
      fSystem: "System",
      fBrowser: "Browser",
      fDevice: "Device",
      fMobile: "Mobile",
      fLocation: "Location",
      fCoords: "Coordinates",
      fTimezone: "Time zone",
      fLanguages: "Languages",
      fScreen: "Screen",
      fPlatform: "Platform",
      fJoined: "Joined",
      fAgent: "User agent",
      selfReported: "self-reported",
      mapLink: "View on map",
      yes: "Yes",
      unknownVal: "unknown",
    },
  };

  var lang = storage.getItem(LS.LANG) === "en" ? "en" : "de";
  function t(key) {
    return (I18N[lang] && I18N[lang][key]) || I18N.de[key] || key;
  }

  function applyI18n() {
    document.documentElement.lang = lang;
    document.title = t("pageTitle");
    document.querySelector('meta[name="description"]').content =
      t("pageDescription");
    document.querySelector('meta[property="og:locale"]').content =
      lang === "de" ? "de_CH" : "en_GB";
    ["og:title", "twitter:title"].forEach(function (name) {
      document.querySelector(
        'meta[property="' + name + '"], meta[name="' + name + '"]',
      ).content = t("pageTitle");
    });
    ["og:description", "twitter:description"].forEach(function (name) {
      document.querySelector(
        'meta[property="' + name + '"], meta[name="' + name + '"]',
      ).content = t("pageDescription");
    });
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    var titled = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < titled.length; j++) {
      titled[j].title = t(titled[j].getAttribute("data-i18n-title"));
      titled[j].setAttribute("aria-label", titled[j].title);
    }

    var segs = document.querySelectorAll(".seg-btn[data-lang]");
    for (var k = 0; k < segs.length; k++) {
      segs[k].classList.toggle(
        "is-active",
        segs[k].getAttribute("data-lang") === lang,
      );
      segs[k].setAttribute(
        "aria-pressed",
        String(segs[k].getAttribute("data-lang") === lang),
      );
    }

    if (els.peersBtn) els.peersBtn.title = t("showParticipants");
    if (cm) cm.setLabel(t("editorLabel"));
    els.peersBtn.setAttribute("aria-label", t("showParticipants"));
    els.rosterPanel.setAttribute("aria-label", t("participants"));
    els.dropzone.setAttribute("aria-label", t("drop"));
    document.querySelectorAll("[data-i18n-label]").forEach(function (node) {
      node.setAttribute("aria-label", t(node.getAttribute("data-i18n-label")));
    });
    renderUpdateResult();
    updateThemeButton();
    $("deviceCountLabel").textContent = t(
      els.peerCount.textContent === "1" ? "device" : "devices",
    );
    updateLimits();
    updateStatus();
    refreshLangOptions();
    refreshFileLabels();
    renderRoster();
  }

  function setLang(next) {
    if (next !== "de" && next !== "en") return;
    lang = next;
    storage.setItem(LS.LANG, lang);
    applyI18n();
  }

  function updateThemeButton() {
    if (!els.themeToggle) return;
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    els.themeToggle.title = t(dark ? "useLightTheme" : "useDarkTheme");
    els.themeToggle.setAttribute("aria-label", els.themeToggle.title);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#1b1d20" : "#f7f7f5";
    storage.setItem(LS.THEME, theme);
    updateThemeButton();
  }

  function cycleTheme() {
    applyTheme(
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "light"
        : "dark",
    );
  }

  function $(id) {
    return document.getElementById(id);
  }

  function groupCode(code) {
    var out = [];
    for (var i = 0; i < code.length; i += GROUP)
      out.push(code.slice(i, i + GROUP));
    return out.join("-");
  }
  function sanitizeCode(raw) {
    var up = (raw || "").toUpperCase();
    var out = "";
    for (var i = 0; i < up.length && out.length < CODE_LEN; i++) {
      if (ALPHABET.indexOf(up[i]) !== -1) out += up[i];
    }
    return out;
  }
  function codeFromPath() {
    var m = location.pathname.match(/^\/s\/([^/]+)\/?$/);
    try {
      return m ? sanitizeCode(decodeURIComponent(m[1])) : null;
    } catch (e) {
      return "invalid";
    }
  }
  function humanSize(n) {
    if (n < 1024) return n + " B";
    var u = ["KiB", "MiB", "GiB", "TiB"],
      i = -1;
    do {
      n /= 1024;
      i++;
    } while (n >= 1024 && i < u.length - 1);
    return (n >= 10 ? Math.round(n) : n.toFixed(1)) + " " + u[i];
  }
  function fmtHMS(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    s -= h * 3600;
    var m = Math.floor(s / 60);
    s -= m * 60;
    var p = function (x) {
      return (x < 10 ? "0" : "") + x;
    };
    return p(h) + ":" + p(m) + ":" + p(s);
  }
  function fmtDuration(ms) {
    var unit =
      ms % 3600000 === 0 ? "hour" : ms % 60000 === 0 ? "minute" : "second";
    var amount =
      ms / (unit === "hour" ? 3600000 : unit === "minute" ? 60000 : 1000);
    return new Intl.NumberFormat(lang, {
      style: "unit",
      unit: unit,
      unitDisplay: "long",
    }).format(amount);
  }
  function fmtMS(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s -= m * 60;
    var p = function (x) {
      return (x < 10 ? "0" : "") + x;
    };
    return p(m) + ":" + p(s);
  }
  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.hidden = false;

    void els.toast.offsetWidth;
    els.toast.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      els.toast.classList.remove("is-show");
      setTimeout(function () {
        els.toast.hidden = true;
      }, 250);
    }, 2600);
  }

  var els = {};
  function cacheEls() {
    els.topbarSession = $("topbarSession");
    els.codeView = $("sessionCodeView");
    els.qrBtn = $("showQRBtn");
    els.peersBtn = $("peersBtn");
    els.peerCount = $("peerCount");
    els.sessionTtl = $("sessionTtl");
    els.rosterPanel = $("rosterPanel");
    els.rosterList = $("rosterList");
    els.rosterCount = $("rosterCount");
    els.themeToggle = $("themeToggle");
    els.leaveBtn = $("leaveBtn");

    els.landing = $("landing");
    els.newBtn = $("newSessionBtn");
    els.joinInput = $("joinInput");
    els.joinBtn = $("joinBtn");
    els.joinError = $("joinError");

    els.workspace = $("workspace");
    els.langSelect = $("langSelect");
    els.charCount = $("charCount");
    els.editorHost = $("editorHost");

    els.dropzone = $("dropzone");
    els.fileInput = $("fileInput");
    els.fileList = $("fileList");
    els.fileEmpty = $("fileEmpty");
    els.toast = $("toast");
  }

  var MODES = [
    { v: "", label: "plaintext" },
    { v: "javascript", label: "JavaScript" },
    { v: "application/json", label: "JSON" },
    { v: "text/typescript", label: "TypeScript" },
    { v: "htmlmixed", label: "HTML" },
    { v: "css", label: "CSS" },
    { v: "xml", label: "XML" },
    { v: "markdown", label: "Markdown" },
    { v: "python", label: "Python" },
    { v: "text/x-go", label: "Go" },
    { v: "rust", label: "Rust" },
    { v: "text/x-php", label: "PHP" },
    { v: "text/x-java", label: "Java" },
    { v: "text/x-csrc", label: "C" },
    { v: "text/x-c++src", label: "C++" },
    { v: "text/x-csharp", label: "C#" },
    { v: "shell", label: "Shell" },
    { v: "yaml", label: "YAML" },
    { v: "text/x-sql", label: "SQL" },
    { v: "dockerfile", label: "Dockerfile" },
    { v: "text/x-properties", label: "INI / Properties" },
    { v: "nginx", label: "Nginx" },
    { v: "powershell", label: "PowerShell" },
    { v: "diff", label: "Diff" },
    { v: "ruby", label: "Ruby" },
    { v: "perl", label: "Perl" },
    { v: "lua", label: "Lua" },
    { v: "toml", label: "TOML" },
  ];
  function buildLangOptions() {
    if (!els.langSelect) return;
    els.langSelect.innerHTML = "";
    for (var i = 0; i < MODES.length; i++) {
      var o = document.createElement("option");
      o.value = MODES[i].v;
      o.textContent =
        MODES[i].label === "plaintext" ? t("plaintext") : MODES[i].label;
      els.langSelect.appendChild(o);
    }
  }
  function refreshLangOptions() {
    if (!els.langSelect || !els.langSelect.options.length) return;

    els.langSelect.options[0].textContent = t("plaintext");
  }

  var cm = null;
  var sendTimer = null;
  var sharedLanguage = "";

  function applyLanguage(value) {
    if (
      !MODES.some(function (mode) {
        return mode.v === value;
      })
    )
      return;
    sharedLanguage = value;
    els.langSelect.value = value;
    if (cm) cm.setLanguage(value);
  }

  function initEditor() {
    cm = window.SwissEditor(els.editorHost, function () {
      updateCharCount();
      dirtyText = cm.getValue();
      syncError = null;
      updateStatus();
      scheduleSend();
    });
    cm.setLabel(t("editorLabel"));
    els.langSelect.addEventListener("change", function () {
      if (!live || !ws || ws.readyState !== WebSocket.OPEN) {
        applyLanguage(sharedLanguage);
        return;
      }
      try {
        ws.send(
          JSON.stringify({ type: "language", language: els.langSelect.value }),
        );
      } catch (error) {
        applyLanguage(sharedLanguage);
        toast(t("languageFailed"));
      }
    });
    $("copyTextBtn").addEventListener("click", function () {
      copyValue(cm.getValue(), "textCopied");
    });
    $("restoreDraftBtn").addEventListener("click", function () {
      if (!live || recoveryText === null) return;
      cm.setValue(recoveryText);
      dirtyText = recoveryText;
      syncError = null;
      clearRecovery();
      updateCharCount();
      sendText();
    });
    $("discardDraftBtn").addEventListener("click", clearRecovery);
  }

  function preserveDraft() {
    if (dirtyText !== null) {
      recoveryText = dirtyText;
      $("recoveryText").value = recoveryText;
      $("recoveryPanel").hidden = false;
    }
  }
  function clearRecovery() {
    recoveryText = null;
    $("recoveryText").value = "";
    $("recoveryPanel").hidden = true;
  }
  function updateStatus() {
    var status = $("connectionStatus");
    if (status)
      status.textContent = live
        ? syncError || t(dirtyText !== null ? "saving" : "saved")
        : t("reconnecting");
  }
  function updateLimits() {
    if (!limits) return;
    $("filesTtlLabel").textContent =
      t("retention") + fmtDuration(limits.fileTtlMs);
    $("dropSub").textContent =
      t("fileLimit") + humanSize(limits.maxUploadBytes);
    document.querySelector('[data-i18n="step4"]').textContent =
      t("sessionDuration") + fmtDuration(limits.sessionTtlMs) + ".";
    document.querySelector('[data-i18n="sec2d"]').textContent =
      t("retention") + fmtDuration(limits.fileTtlMs);
    $("privacyNotice").textContent = t(
      limits.peerInsights ? "privacyOn" : "privacyOff",
    );
    els.peersBtn.disabled = !limits.peerInsights;
    els.peersBtn.removeAttribute("aria-haspopup");
    if (limits.peerInsights)
      els.peersBtn.setAttribute("aria-haspopup", "dialog");
  }

  function updateCharCount() {
    if (els.charCount && cm) {
      els.charCount.textContent =
        humanSize(new TextEncoder().encode(cm.getValue()).length) +
        (limits ? " / " + humanSize(limits.maxTextBytes) : "");
    }
  }

  function scheduleSend() {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(sendText, SEND_DEBOUNCE_MS);
  }
  function sendText() {
    if (
      !live ||
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      !cm ||
      dirtyText === null
    )
      return;
    if (new TextEncoder().encode(cm.getValue()).length > limits.maxTextBytes) {
      preserveDraft();
      syncError = t("textTooLarge") + humanSize(limits.maxTextBytes);
      updateStatus();
      toast(syncError);
      return;
    }
    try {
      ws.send(JSON.stringify({ type: "text", content: cm.getValue() }));
      sentTexts.push(cm.getValue());
    } catch (e) {}
  }

  function applyRemoteText(content) {
    if (!cm) return;
    if (cm.getValue() === content) return;
    preserveDraft();
    clearTimeout(sendTimer);
    dirtyText = null;
    syncError = null;
    cm.setValue(content);
    updateStatus();
    updateCharCount();
  }

  var files = [];
  var uploads = {};
  var fileTtlMs = 15 * 60 * 1000;

  function renderFiles() {
    if (
      previewFile &&
      !files.some(function (file) {
        return file.id === previewFile.id;
      })
    ) {
      invalidatePreview();
    }
    var count = files.length + Object.keys(uploads).length;
    $("tabFileCount").textContent = count;
    $("tabFileCount").hidden = count === 0;
    if (!els.fileList) return;
    els.fileList.innerHTML = "";

    var anyUpload = false,
      key;
    for (key in uploads) {
      if (uploads.hasOwnProperty(key)) {
        anyUpload = true;
        break;
      }
    }

    els.fileEmpty.hidden = files.length > 0 || anyUpload;

    for (key in uploads) {
      if (!uploads.hasOwnProperty(key)) continue;
      var u = uploads[key];
      var pct = u.size > 0 ? Math.round((u.loaded / u.size) * 100) : 0;
      var liU = document.createElement("li");
      liU.className = "fileitem is-uploading";
      var nameU = document.createElement("span");
      nameU.className = "fileitem-name";
      nameU.textContent = u.name;
      var metaU = document.createElement("span");
      metaU.className = "fileitem-meta";
      metaU.textContent = t("uploading") + " " + pct + "%";
      var prog = document.createElement("div");
      prog.className = "fileitem-progress";
      var bar = document.createElement("span");
      bar.style.width = pct + "%";
      prog.appendChild(bar);
      liU.appendChild(nameU);
      liU.appendChild(metaU);
      liU.appendChild(prog);
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ghostbtn";
      cancel.textContent = t("cancel");
      (function (upload) {
        cancel.addEventListener("click", function () {
          upload.xhr.abort();
        });
      })(u);
      liU.appendChild(cancel);
      els.fileList.appendChild(liU);
    }

    for (var i = 0; i < files.length; i++) {
      els.fileList.appendChild(fileRow(files[i]));
    }
  }

  function fileRow(f) {
    var li = document.createElement("li");
    li.className = "fileitem";
    li.setAttribute("data-id", f.id);

    var name = document.createElement("button");
    name.type = "button";
    name.className = "fileitem-name";
    name.textContent = f.name;
    name.title = f.name;
    name.setAttribute("aria-label", t("preview") + ": " + f.name);
    name.addEventListener("click", function () {
      openFilePreview(f);
    });

    var meta = document.createElement("span");
    meta.className = "fileitem-meta";
    var size = document.createElement("span");
    size.textContent = humanSize(f.size);
    var ttl = document.createElement("span");
    ttl.className = "ttl-left";
    ttl.setAttribute("data-expires", String(f.expiresAt));
    meta.appendChild(size);
    meta.appendChild(document.createTextNode(", "));
    meta.appendChild(ttl);

    var actions = document.createElement("div");
    actions.className = "fileitem-actions";

    var dl = document.createElement("a");
    dl.className = "fileitem-dl";
    dl.href =
      "/api/sessions/" +
      encodeURIComponent(sessionCode) +
      "/files/" +
      encodeURIComponent(f.id);
    dl.setAttribute("download", f.name);
    dl.title = t("download");
    dl.setAttribute("aria-label", t("download") + ": " + f.name);
    dl.appendChild(makeIcon("M12 4v12m-5-5 5 5 5-5M4 17v4h16v-4"));

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "fileitem-rm";
    rm.title = t("remove");
    rm.setAttribute("aria-label", t("remove") + ": " + f.name);
    rm.appendChild(makeIcon("m6 6 12 12M6 18 18 6"));
    rm.addEventListener("click", function () {
      if (window.confirm(t("confirmDelete"))) deleteFile(f.id);
    });

    actions.appendChild(dl);
    actions.appendChild(rm);

    li.appendChild(name);
    li.appendChild(meta);
    li.appendChild(actions);
    return li;
  }

  function refreshFileLabels() {
    var dls = document.querySelectorAll(".fileitem-dl");
    for (var i = 0; i < dls.length; i++) dls[i].title = t("download");
    var rms = document.querySelectorAll(".fileitem-rm");
    for (var j = 0; j < rms.length; j++) rms[j].title = t("remove");
  }

  function makeIcon(path) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    var shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", path);
    svg.appendChild(shape);
    return svg;
  }

  function tmpId() {
    return "u" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  function enqueueUploads(list) {
    if (!live) {
      toast(t("reconnecting"));
      return;
    }
    for (var i = 0; i < list.length; i++) {
      if (list[i].size > limits.maxUploadBytes) {
        toast(
          list[i].name +
            ": " +
            t("fileLimit") +
            humanSize(limits.maxUploadBytes),
        );
        continue;
      }
      uploadOne(list[i]);
    }
  }

  function uploadOne(file) {
    var id = tmpId();
    var xhr = new XMLHttpRequest();
    var uploadCode = sessionCode;
    uploads[id] = { name: file.name, size: file.size, loaded: 0, xhr: xhr };
    renderFiles();
    xhr.timeout = 30 * 60 * 1000;
    xhr.open(
      "POST",
      "/api/sessions/" + encodeURIComponent(sessionCode) + "/files",
      true,
    );
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.upload.onprogress = function (e) {
      if (uploads[id] && e.lengthComputable) {
        uploads[id].loaded = e.loaded;
        renderFiles();
      }
    };
    xhr.onload = function () {
      if (sessionCode !== uploadCode) return;
      delete uploads[id];
      if (xhr.status === 201) {
        try {
          var meta = JSON.parse(xhr.responseText);
          mergeFile(meta);
        } catch (e) {}
      } else {
        uploadError(xhr.status, xhr.responseText);
      }
      renderFiles();
    };
    xhr.onerror = xhr.ontimeout = function () {
      if (sessionCode !== uploadCode) return;
      delete uploads[id];
      toast(t("uploadFail"));
      renderFiles();
    };
    xhr.onabort = function () {
      delete uploads[id];
      renderFiles();
    };
    xhr.send(file);
  }

  function uploadError(status, body) {
    var reason = "";
    try {
      reason = JSON.parse(body).error;
    } catch (e) {}
    if (status === 413)
      toast(
        reason === "session storage limit reached"
          ? t("sessFull")
          : t("fileLimit") + humanSize(limits.maxUploadBytes),
      );
    else if (status === 503) toast(t("serverBusy"));
    else if (status === 409) toast(t("tooMany"));
    else toast(t("uploadFail"));
  }

  function mergeFile(meta) {
    for (var i = 0; i < files.length; i++) if (files[i].id === meta.id) return;
    files.push(meta);
  }

  function deleteFile(id) {
    var deleteCode = sessionCode;
    var xhr = new XMLHttpRequest();
    xhr.open(
      "DELETE",
      "/api/sessions/" +
        encodeURIComponent(sessionCode) +
        "/files/" +
        encodeURIComponent(id),
      true,
    );
    xhr.onload = function () {
      if (sessionCode !== deleteCode) return;
      if (xhr.status !== 204 && xhr.status !== 404) {
        toast(t("deleteFail"));
        return;
      }
      files = files.filter(function (f) {
        return f.id !== id;
      });
      renderFiles();
    };
    xhr.onerror = function () {
      toast(t("deleteFail"));
    };
    xhr.send();
  }

  var clockOffset = 0;
  var sessionExpiresAt = 0;
  function serverNow() {
    return Date.now() + clockOffset;
  }

  function tickClocks() {
    var now = serverNow();
    if (sessionExpiresAt && els.sessionTtl) {
      var left = sessionExpiresAt - now;
      if (left <= 0 && sessionCode) {
        endSession(t("expired"));
        return;
      }
      els.sessionTtl.textContent = fmtHMS(left);
      els.sessionTtl.classList.toggle("is-urgent", left <= 5 * 60 * 1000);
    }
    var current = files.filter(function (f) {
      return f.expiresAt > now;
    });
    if (current.length !== files.length) {
      files = current;
      renderFiles();
    }
    var ttls = document.querySelectorAll(".fileitem .ttl-left");
    for (var i = 0; i < ttls.length; i++) {
      var exp = parseInt(ttls[i].getAttribute("data-expires"), 10);
      var fl = exp - now;
      ttls[i].textContent = fmtMS(fl);
      ttls[i].classList.toggle("is-urgent", fl <= 60 * 1000);
    }
  }

  var ws = null;
  var sessionCode = null;
  var remoteRev = -1;
  var wsBackoff = 500;
  var wsClosedByUser = false;
  var roster = [];
  var selfId = null;
  var openPeerId = null;
  var rosterOpen = false;
  var landingWired = false;
  var sessionWired = false;
  var clockTimer = null;

  function showLanding() {
    document.body.dataset.view = "landing";
    els.landing.hidden = false;
    els.workspace.hidden = true;
    els.topbarSession.hidden = true;
    els.leaveBtn.hidden = true;
    els.workspace.classList.remove("is-booting");
  }

  function showWorkspace(opts) {
    document.body.dataset.view = "session";
    selectWorkspacePane("text");
    opts = opts || {};
    els.landing.hidden = true;
    els.workspace.hidden = false;
    els.topbarSession.hidden = false;
    els.leaveBtn.hidden = false;
    els.workspace.classList.toggle("is-booting", !!opts.booting);
  }

  function navigate(path, replace) {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
  }

  function consumeNotice(fallback) {
    try {
      var notice =
        sessionStorage.getItem("swisspaste:notice") || fallback || "";
      if (notice) {
        toast(notice);
        sessionStorage.removeItem("swisspaste:notice");
      }
    } catch (e) {}
  }

  function destroySession() {
    closeDialogs();
    wsClosedByUser = true;
    clearTimeout(reconnectTimer);
    clearTimeout(sendTimer);
    reconnectTimer = null;
    dirtyText = null;
    syncError = null;
    sentTexts = [];
    clearRecovery();
    Object.keys(uploads).forEach(function (id) {
      uploads[id].xhr.abort();
    });
    if (ws) {
      ws.onclose = ws.onmessage = ws.onopen = ws.onerror = null;
    }
    try {
      if (ws) ws.close();
    } catch (e) {}
    ws = null;
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (cm) {
      cm.setValue("");
      cm.clearHistory();
      cm.setLanguage("");
      sharedLanguage = "";
      updateCharCount();
    }
    sessionCode = null;
    remoteRev = -1;
    wsBackoff = 500;
    files = [];
    uploads = {};
    roster = [];
    selfId = null;
    openPeerId = null;
    sessionExpiresAt = 0;
    toggleRoster(false);
    setLive(false);
    renderFiles();
    renderRoster();
  }

  function wsURL() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return (
      proto + "//" + location.host + "/ws/" + encodeURIComponent(sessionCode)
    );
  }

  function connectWS() {
    if (wsClosedByUser || !sessionCode || navigator.onLine === false) return;
    var socket;
    try {
      socket = new WebSocket(wsURL());
      ws = socket;
    } catch (e) {
      scheduleReconnect();
      return;
    }
    socket.onopen = function () {
      if (ws !== socket) return;
      wsBackoff = 500;
    };
    socket.onmessage = function (ev) {
      if (ws !== socket) return;
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      handleWire(msg);
    };
    socket.onclose = function () {
      if (ws !== socket) return;
      preserveDraft();
      clearTimeout(sendTimer);
      sentTexts = [];
      setLive(false);
      if (!wsClosedByUser) scheduleReconnect();
    };
    socket.onerror = function () {
      socket.close();
    };
  }

  function scheduleReconnect() {
    setLive(false);
    clearTimeout(reconnectTimer);
    var code = sessionCode;
    reconnectTimer = setTimeout(function () {
      if (wsClosedByUser || sessionCode !== code) return;
      fetch("/api/sessions/" + encodeURIComponent(code), { cache: "no-store" })
        .then(function (response) {
          if (wsClosedByUser || sessionCode !== code) return;
          if (response.status === 404) endSession(t("expired"));
          else connectWS();
        })
        .catch(function () {
          if (sessionCode === code && !wsClosedByUser) scheduleReconnect();
        });
    }, wsBackoff);
    wsBackoff = Math.min(wsBackoff * 1.8, 10000);
  }

  function setLive(on) {
    live = on;
    if (els.peersBtn) els.peersBtn.classList.toggle("is-live", on);
    if (cm) cm.setReadOnly(!on);
    if (els.langSelect) els.langSelect.disabled = !on;
    if (els.dropzone) els.dropzone.setAttribute("aria-disabled", String(!on));
    $("restoreDraftBtn").disabled = !on;
    updateStatus();
  }

  function handleWire(msg) {
    switch (msg.type) {
      case "init":
        sentTexts = [];
        syncError = null;
        if (recoveryText === msg.content) clearRecovery();
        if (dirtyText === msg.content) dirtyText = null;
        if (typeof msg.serverNow === "number")
          clockOffset = msg.serverNow - Date.now();
        if (typeof msg.fileTtlMs === "number" && msg.fileTtlMs > 0)
          fileTtlMs = msg.fileTtlMs;
        if (typeof msg.expiresAt === "number") sessionExpiresAt = msg.expiresAt;
        remoteRev = typeof msg.rev === "number" ? msg.rev : 0;
        if (typeof msg.content === "string") applyRemoteText(msg.content);
        applyLanguage(typeof msg.language === "string" ? msg.language : "");
        updateCharCount();
        files = Array.isArray(msg.files) ? msg.files : [];
        renderFiles();
        if (msg.selfId) selfId = msg.selfId;
        roster = Array.isArray(msg.roster) ? msg.roster : [];
        renderRoster();
        setPeers(msg.peers);
        els.workspace.classList.remove("is-booting");
        setLive(true);
        if (limits.peerInsights) sendHello();
        tickClocks();
        break;
      case "language":
        if (typeof msg.language === "string") applyLanguage(msg.language);
        break;
      case "language_error":
        applyLanguage(sharedLanguage);
        toast(t("languageFailed"));
        break;
      case "ack":
        var acknowledged = sentTexts.shift();
        if (dirtyText === acknowledged) dirtyText = null;
        if (typeof msg.rev === "number" && msg.rev > remoteRev) {
          remoteRev = msg.rev;
          if (dirtyText === null && typeof msg.content === "string")
            applyRemoteText(msg.content);
        }
        if (recoveryText === acknowledged && recoveryText === cm.getValue())
          clearRecovery();
        updateStatus();
        break;
      case "error":
        sentTexts.shift();
        syncError = t("serverBusy");
        updateStatus();
        preserveDraft();
        toast(
          msg.error === "paste exceeds maximum size"
            ? t("textTooLarge") + humanSize(limits.maxTextBytes)
            : t("serverBusy"),
        );
        break;
      case "text":
        if (typeof msg.rev === "number" && msg.rev <= remoteRev) break;
        if (typeof msg.rev === "number") remoteRev = msg.rev;
        if (typeof msg.content === "string") applyRemoteText(msg.content);
        break;
      case "files":
        files = Array.isArray(msg.files) ? msg.files : [];
        renderFiles();
        tickClocks();
        if (typeof msg.peers === "number") setPeers(msg.peers);
        break;
      case "roster":
        roster = Array.isArray(msg.roster) ? msg.roster : [];
        renderRoster();
        if (typeof msg.peers === "number") setPeers(msg.peers);
        break;
      case "peers":
        setPeers(msg.peers);
        break;
      case "expired":
        endSession(t("gone"));
        break;
    }
  }

  function setPeers(n) {
    if (els.peerCount && typeof n === "number") {
      els.peerCount.textContent = String(n);
      $("deviceCountLabel").textContent = t(n === 1 ? "device" : "devices");
    }
  }

  function sendHello() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    var tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) {}
    var langs = [];
    try {
      langs = (navigator.languages || [navigator.language])
        .filter(Boolean)
        .slice(0, 8);
    } catch (e) {}
    var screenStr = "";
    try {
      var dpr = window.devicePixelRatio || 1;
      screenStr =
        window.screen.width +
        "x" +
        window.screen.height +
        (dpr !== 1 ? " @" + Math.round(dpr * 100) / 100 + "x" : "");
    } catch (e) {}
    var platform = "";
    try {
      platform =
        (navigator.userAgentData && navigator.userAgentData.platform) ||
        navigator.platform ||
        "";
    } catch (e) {}
    try {
      ws.send(
        JSON.stringify({
          type: "hello",
          timezone: tz,
          languages: langs,
          screen: screenStr,
          platform: platform,
        }),
      );
    } catch (e) {}
  }

  function peerSummary(p) {
    var bits = [];
    if (p.os) bits.push(p.os);
    if (p.browser) bits.push(p.browser);
    var line = bits.join(", ");
    if (p.city || p.countryCode || p.country) {
      var loc = p.city || "";
      var cc = p.countryCode || p.country || "";
      loc = loc ? (cc ? loc + ", " + cc : loc) : cc;
      line = line ? line + ", " + loc : loc;
    }
    return line;
  }

  function detailRow(dl, label, value, opts) {
    opts = opts || {};
    if (!opts.node && (value === undefined || value === null || value === ""))
      return;
    var dt = document.createElement("dt");
    dt.textContent = label;
    if (opts.hint) {
      var h = document.createElement("span");
      h.className = "roster-self-hint";
      h.textContent = " (" + opts.hint + ")";
      dt.appendChild(h);
    }
    var dd = document.createElement("dd");
    if (opts.mono) dd.className = "mono";
    if (opts.node) dd.appendChild(opts.node);
    else dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function buildDetail(p) {
    var dl = document.createElement("dl");
    dl.className = "roster-detail";

    detailRow(dl, t("fIp"), p.ip || t("unknownVal"), { mono: true });

    var sys = p.os || "";
    if (p.osVersion) sys += (sys ? " " : "") + p.osVersion;
    detailRow(dl, t("fSystem"), sys);

    var br = p.browser || "";
    if (p.browserVersion) br += (br ? " " : "") + p.browserVersion;
    detailRow(dl, t("fBrowser"), br);

    if (p.device) detailRow(dl, t("fDevice"), p.device);
    if (p.mobile) detailRow(dl, t("fMobile"), t("yes"));

    var locParts = [];
    if (p.city) locParts.push(p.city);
    if (p.region && p.region !== p.city) locParts.push(p.region);
    if (p.country)
      locParts.push(
        p.country + (p.countryCode ? " (" + p.countryCode + ")" : ""),
      );
    else if (p.countryCode) locParts.push(p.countryCode);
    if (locParts.length) detailRow(dl, t("fLocation"), locParts.join(", "));

    if (
      typeof p.lat === "number" &&
      typeof p.lon === "number" &&
      (p.lat || p.lon)
    ) {
      var link = document.createElement("a");
      link.className = "roster-maplink";
      link.href =
        "https://www.openstreetmap.org/?mlat=" +
        encodeURIComponent(p.lat) +
        "&mlon=" +
        encodeURIComponent(p.lon) +
        "#map=11/" +
        p.lat +
        "/" +
        p.lon;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent =
        Math.round(p.lat * 1000) / 1000 +
        ", " +
        Math.round(p.lon * 1000) / 1000 +
        ", " +
        t("mapLink");
      detailRow(dl, t("fCoords"), "", { node: link, mono: true });
    }

    detailRow(dl, t("fTimezone"), p.timezone, { hint: t("selfReported") });
    if (p.languages && p.languages.length) {
      detailRow(dl, t("fLanguages"), p.languages.join(", "), {
        hint: t("selfReported"),
      });
    }
    detailRow(dl, t("fScreen"), p.screen, {
      hint: t("selfReported"),
      mono: true,
    });
    detailRow(dl, t("fPlatform"), p.platform, { hint: t("selfReported") });

    if (p.joinedAt) {
      var d = new Date(p.joinedAt);
      detailRow(dl, t("fJoined"), d.toLocaleTimeString(), { mono: true });
    }
    return dl;
  }

  function renderRoster() {
    if (!els.rosterList) return;
    if (els.rosterCount) els.rosterCount.textContent = String(roster.length);
    els.rosterList.innerHTML = "";

    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      var li = document.createElement("li");
      li.className = "roster-item";
      if (p.id === openPeerId) li.className += " is-open";

      var row = document.createElement("button");
      row.type = "button";
      row.className = "roster-row";
      row.setAttribute("aria-expanded", String(p.id === openPeerId));

      var dot = document.createElement("span");
      dot.className = "roster-rowdot";

      var main = document.createElement("span");
      main.className = "roster-rowmain";
      var ip = document.createElement("div");
      ip.className = "roster-ip";
      ip.textContent = p.ip || t("anonPeer");
      if (p.id === selfId) {
        var you = document.createElement("span");
        you.className = "roster-you";
        you.textContent = t("you");
        ip.appendChild(you);
      }
      var sub = document.createElement("div");
      sub.className = "roster-sub";
      sub.textContent = peerSummary(p);
      main.appendChild(ip);
      if (sub.textContent) main.appendChild(sub);

      var caret = document.createElement("span");
      caret.className = "roster-caret";
      caret.appendChild(makeIcon("m6 9 6 6 6-6"));

      row.appendChild(dot);
      row.appendChild(main);
      row.appendChild(caret);

      (function (peerId) {
        row.addEventListener("click", function () {
          openPeerId = openPeerId === peerId ? null : peerId;
          renderRoster();
        });
      })(p.id);

      li.appendChild(row);
      if (p.id === openPeerId) li.appendChild(buildDetail(p));
      els.rosterList.appendChild(li);
    }
  }

  function toggleRoster(force) {
    rosterOpen = typeof force === "boolean" ? force : !rosterOpen;
    if (els.rosterPanel) els.rosterPanel.hidden = !rosterOpen;
    if (els.peersBtn)
      els.peersBtn.setAttribute("aria-expanded", rosterOpen ? "true" : "false");
  }

  function wireRoster() {
    if (els.peersBtn) {
      els.peersBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleRoster();
      });
    }
    document.addEventListener("click", function (e) {
      if (!rosterOpen) return;
      if (els.rosterPanel.contains(e.target) || els.peersBtn.contains(e.target))
        return;
      toggleRoster(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && rosterOpen) {
        toggleRoster(false);
        els.peersBtn.focus();
      }
    });
  }

  function canLeave() {
    return (
      (dirtyText === null &&
        recoveryText === null &&
        !Object.keys(uploads).length) ||
      window.confirm(t("leaveUnsynced"))
    );
  }
  function endSession(message) {
    if (!message && !canLeave()) return;
    destroySession();
    storage.removeItem(LS.LAST);
    if (message) {
      try {
        sessionStorage.setItem("swisspaste:notice", message);
      } catch (e) {}
    }
    navigate("/");
    showLanding();
    consumeNotice();
  }

  function showJoinError(message) {
    if (!els.joinError) return;
    els.joinError.textContent = message;
    els.joinError.hidden = false;
  }
  function clearJoinError() {
    if (els.joinError) els.joinError.hidden = true;
  }

  function createSession() {
    els.newBtn.disabled = true;
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/sessions", true);
    xhr.onload = function () {
      els.newBtn.disabled = false;
      if (xhr.status === 201) {
        try {
          var r = JSON.parse(xhr.responseText);
          if (r && r.code) {
            navigate("/s/" + r.code);
            startSession(r.code);
            return;
          }
        } catch (e) {}
      }
      showLanding();
      toast(t("createFail"));
    };
    xhr.onerror = function () {
      els.newBtn.disabled = false;
      showLanding();
      toast(t("createFail"));
    };
    xhr.send();
  }

  function joinSession() {
    clearJoinError();
    var code = sanitizeCode(els.joinInput.value);
    if (code.length !== CODE_LEN) {
      showJoinError(t("badCode"));
      return;
    }
    els.joinBtn.disabled = true;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/sessions/" + encodeURIComponent(code), true);
    xhr.onload = function () {
      els.joinBtn.disabled = false;
      if (xhr.status === 200) {
        navigate("/s/" + code);
        startSession(code);
      } else {
        showLanding();
        showJoinError(t("notFound"));
      }
    };
    xhr.onerror = function () {
      els.joinBtn.disabled = false;
      showLanding();
      showJoinError(t("networkError"));
    };
    xhr.send();
  }

  function wireLanding() {
    showLanding();
    consumeNotice();

    if (landingWired) return;
    landingWired = true;

    els.newBtn.addEventListener("click", createSession);
    els.joinBtn.addEventListener("click", joinSession);
    els.joinInput.addEventListener("input", function () {
      var pos = els.joinInput.selectionStart;
      var before = els.joinInput.value;
      els.joinInput.value = groupCode(sanitizeCode(before));
      if (pos >= before.length) {
        els.joinInput.selectionStart = els.joinInput.selectionEnd =
          els.joinInput.value.length;
      }
      clearJoinError();
    });
    els.joinInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") joinSession();
    });
  }

  var previewFile = null;
  var previewController = null;

  function clearPreview() {
    if (previewController) previewController.abort();
    previewController = null;
    previewFile = null;
    $("previewContent").replaceChildren();
    $("previewContent").setAttribute("aria-busy", "false");
    $("previewDownload").removeAttribute("href");
    $("previewDownload").removeAttribute("download");
    $("previewTitle").textContent = "";
    $("previewSize").textContent = "";
  }

  function previewMessage(key) {
    var paragraph = document.createElement("p");
    paragraph.className = "preview-message";
    paragraph.setAttribute("role", "status");
    paragraph.textContent = t(key);
    $("previewContent").replaceChildren(paragraph);
  }

  function invalidatePreview() {
    clearPreview();
    $("previewTitle").textContent = t("preview");
    $("previewDownload").hidden = true;
    previewMessage("previewGone");
  }

  async function openFilePreview(file) {
    if (!sessionCode) return;
    clearPreview();
    previewFile = file;
    var controller = new AbortController();
    previewController = controller;
    var url =
      "/api/sessions/" +
      encodeURIComponent(sessionCode) +
      "/files/" +
      encodeURIComponent(file.id);
    $("previewTitle").textContent = file.name;
    $("previewSize").textContent = humanSize(file.size);
    $("previewDownload").href = url;
    $("previewDownload").download = file.name;
    $("previewDownload").hidden = false;
    previewMessage("previewLoading");
    $("previewContent").setAttribute("aria-busy", "true");
    $("previewDialog").showModal();
    try {
      var renderer = await import("/static/preview.bundle.js");
      if (!controller.signal.aborted)
        await renderer.renderPreview(
          $("previewContent"),
          file,
          url,
          controller.signal,
          t,
        );
    } catch (error) {
      if (!controller.signal.aborted) {
        previewMessage("previewFailed");
        $("previewContent").setAttribute("aria-busy", "false");
      }
    }
  }

  async function openQRCode() {
    if (!sessionCode) return;
    var url = location.origin + "/s/" + sessionCode;
    $("qrURL").href = url;
    $("qrURL").textContent = url;
    $("qrError").hidden = true;
    $("qrCanvas").hidden = false;
    $("qrDialog").showModal();
    try {
      await window.SwissQRCode($("qrCanvas"), url);
    } catch (error) {
      $("qrCanvas").hidden = true;
      $("qrError").textContent = t("qrFailed");
      $("qrError").hidden = false;
    }
  }

  function closeDialogs() {
    clearPreview();
    $("previewDialog").close();
    $("qrDialog").close();
    $("qrURL").textContent = "";
    $("qrURL").removeAttribute("href");
    $("qrCanvas").width = 0;
    $("qrCanvas").height = 0;
  }

  function wireDialogs() {
    document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        $(button.dataset.closeDialog).close();
      });
    });
    ["qrDialog", "previewDialog"].forEach(function (id) {
      $(id).addEventListener("click", function (event) {
        if (event.target === $(id)) $(id).close();
      });
    });
    $("previewDialog").addEventListener("close", function () {
      if (!$("previewDialog").open) clearPreview();
    });
    $("qrDialog").addEventListener("close", function () {
      if ($("qrDialog").open) return;
      $("qrURL").textContent = "";
      $("qrURL").removeAttribute("href");
      $("qrCanvas").width = 0;
      $("qrCanvas").height = 0;
    });
    $("qrCopyLinkBtn").addEventListener("click", function () {
      if (sessionCode)
        copyValue(location.origin + "/s/" + sessionCode, "linkCopied");
    });
  }

  function copyValue(value, message) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      (document.querySelector("dialog[open]") || document.body).appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {}
      ta.remove();
      toast(t(ok ? message : "copyFailedHint"));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () {
        toast(t(message));
      }, fallback);
    } else fallback();
  }

  function wireDropzone() {
    var dz = els.dropzone;
    dz.addEventListener("click", function () {
      if (live) els.fileInput.click();
    });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (live) els.fileInput.click();
      }
    });
    els.fileInput.addEventListener("change", function () {
      if (els.fileInput.files && els.fileInput.files.length) {
        enqueueUploads(els.fileInput.files);
        els.fileInput.value = "";
      }
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add("is-drag");
      });
    });
    ["dragleave", "dragend", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (ev !== "drop") dz.classList.remove("is-drag");
      });
    });
    dz.addEventListener("drop", function (e) {
      dz.classList.remove("is-drag");
      if (
        e.dataTransfer &&
        e.dataTransfer.files &&
        e.dataTransfer.files.length
      ) {
        enqueueUploads(e.dataTransfer.files);
      }
    });
  }

  function startSession(code) {
    if (sessionCode && sessionCode !== code) destroySession();
    sessionCode = code;
    // Keep session secrets in the URL without persisting them in localStorage
    storage.removeItem(LS.LAST);

    showWorkspace({ booting: false });
    els.codeView.textContent = groupCode(code);

    if (!sessionWired) {
      sessionWired = true;
      els.qrBtn.addEventListener("click", openQRCode);
      $("copyLinkBtn").addEventListener("click", function () {
        copyValue(location.origin + "/s/" + sessionCode, "linkCopied");
      });
      els.leaveBtn.addEventListener("click", function () {
        endSession("");
      });
      buildLangOptions();
      initEditor();
      wireDropzone();
      wireRoster();
    } else {
      buildLangOptions();
      refreshLangOptions();
      updateCharCount();
    }

    setLive(false);
    wsClosedByUser = false;
    connectWS();
    if (!clockTimer) clockTimer = setInterval(tickClocks, 1000);
    tickClocks();
  }

  function bootSession(code) {
    if (sessionCode === code && ws) return;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/sessions/" + encodeURIComponent(code), true);
    xhr.onload = function () {
      if (codeFromPath() !== code) return;
      if (xhr.status === 200) startSession(code);
      else {
        try {
          sessionStorage.setItem("swisspaste:notice", t("notFound"));
        } catch (e) {}
        navigate("/", true);
        destroySession();
        wireLanding();
      }
    };
    xhr.onerror = function () {
      try {
        sessionStorage.setItem("swisspaste:notice", t("notFound"));
      } catch (e) {}
      navigate("/", true);
      destroySession();
      wireLanding();
    };
    xhr.send();
  }

  function routeFromPath() {
    var code = codeFromPath();
    if (sessionCode && code !== sessionCode && !canLeave()) {
      navigate("/s/" + sessionCode, true);
      return;
    }
    if (code && code.length === CODE_LEN) {
      if (sessionCode === code) return;
      bootSession(code);
    } else if (code) {
      try {
        sessionStorage.setItem("swisspaste:notice", t("badCode"));
      } catch (e) {}
      navigate("/", true);
      destroySession();
      wireLanding();
    } else {
      destroySession();
      wireLanding();
    }
  }

  var workspacePane = "text";
  var compactWorkspace = window.matchMedia("(max-width: 760px)");

  function selectWorkspacePane(name) {
    workspacePane = name;
    $("workspaceTabs").hidden = !compactWorkspace.matches;
    ["text", "files"].forEach(function (pane) {
      var selected = pane === workspacePane;
      var tab = $(pane + "Tab");
      var panel = $(pane === "text" ? "editorPane" : "filesPane");
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = compactWorkspace.matches && !selected;
      if (compactWorkspace.matches) {
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
      } else {
        panel.removeAttribute("role");
        panel.removeAttribute("aria-labelledby");
      }
    });
  }

  function wireWorkspaceTabs() {
    compactWorkspace.addEventListener("change", function () {
      selectWorkspacePane(workspacePane);
    });
    ["text", "files"].forEach(function (name) {
      var tab = $(name + "Tab");
      tab.addEventListener("click", function () {
        selectWorkspacePane(name);
      });
      tab.addEventListener("keydown", function (event) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        var next =
          event.key === "Home"
            ? "text"
            : event.key === "End"
              ? "files"
              : name === "text"
                ? "files"
                : "text";
        selectWorkspacePane(next);
        $(next + "Tab").focus();
      });
    });
    selectWorkspacePane("text");
  }

  function wireInstallation() {
    var pendingPrompt = null;
    var button = $("installAppBtn");
    var standalone = window.matchMedia("(display-mode: standalone)");
    function updateButton() {
      button.hidden =
        !pendingPrompt || standalone.matches || navigator.standalone === true;
    }
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      pendingPrompt = event;
      updateButton();
    });
    window.addEventListener("appinstalled", function () {
      pendingPrompt = null;
      updateButton();
    });
    standalone.addEventListener("change", updateButton);
    button.addEventListener("click", async function () {
      if (!pendingPrompt) return;
      var prompt = pendingPrompt;
      pendingPrompt = null;
      updateButton();
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch (error) {
        toast(t("installFailed"));
      }
    });
  }

  function wireChrome() {
    applyTheme(
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light",
    );
    wireInstallation();
    wireWorkspaceTabs();
    wireDialogs();
    if (els.themeToggle) els.themeToggle.addEventListener("click", cycleTheme);

    var segs = document.querySelectorAll(".seg-btn[data-lang]");
    for (var i = 0; i < segs.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          setLang(btn.getAttribute("data-lang"));
        });
      })(segs[i]);
    }

    var brand = document.querySelector(".brand[data-nav]");
    if (brand) {
      brand.addEventListener("click", function (e) {
        if (sessionCode) {
          e.preventDefault();
          endSession("");
        }
      });
    }

    window.addEventListener("offline", function () {
      preserveDraft();
      clearTimeout(sendTimer);
      setLive(false);
      if (ws) ws.close();
    });
    window.addEventListener("online", function () {
      if (sessionCode && !live) {
        clearTimeout(reconnectTimer);
        connectWS();
      }
    });
    window.addEventListener("popstate", routeFromPath);
    window.addEventListener("beforeunload", function (e) {
      if (
        dirtyText !== null ||
        recoveryText !== null ||
        Object.keys(uploads).length
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  var updateResult = null;
  var checkingUpdates = false;

  function renderUpdateResult() {
    if (!$("updateStatus")) return;
    $("updateResult").hidden = !checkingUpdates && !updateResult;
    $("updateLink").hidden = true;
    if (checkingUpdates) {
      $("updateStatus").textContent = t("checkingUpdates");
      return;
    }
    if (!updateResult) return;
    var keys = {
      current: "updateCurrent",
      no_releases: "updateUnreleased",
      unavailable: "updateUnavailable",
    };
    var available =
      updateResult.status === "available" &&
      /^https:\/\/github\.com\/swissmakers\/swisspaste\/tree\/v?\d+\.\d+\.\d+$/.test(
        updateResult.url,
      );
    $("updateStatus").textContent = available
      ? t("updateAvailable") + " v" + updateResult.latest + "."
      : t(keys[updateResult.status] || "updateUnavailable");
    if (available) {
      $("updateLink").href = updateResult.url;
      $("updateLink").hidden = false;
    }
  }

  async function checkForUpdates() {
    if (checkingUpdates) return;
    checkingUpdates = true;
    $("checkUpdatesBtn").disabled = true;
    renderUpdateResult();
    try {
      var response = await fetch("/api/updates", {
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error("updates");
      updateResult = await response.json();
    } catch (error) {
      updateResult = { status: "unavailable" };
    } finally {
      checkingUpdates = false;
      $("checkUpdatesBtn").disabled = false;
      renderUpdateResult();
    }
  }

  async function loadBackground() {
    try {
      var response = await fetch("/static/img/bg_live/manifest.json", {
        cache: "no-cache",
      });
      if (!response.ok) return;
      var manifest = await response.json();
      var images = manifest.images.filter(function (item) {
        return (
          item.variants.length &&
          item.variants.every(function (variant) {
            return (
              /^\/static\/img\/bg_live\/[a-f0-9]{24}-[0-9]+\.webp$/.test(
                variant.url,
              ) &&
              Number.isInteger(variant.width) &&
              variant.width > 0
            );
          })
        );
      });
      var previous;
      try {
        previous = sessionStorage.getItem("swisspaste:background");
      } catch (error) {}
      var choices =
        images.length > 1
          ? images.filter(function (item) {
              return item.id !== previous;
            })
          : images;
      if (!choices.length) return;
      var random = new Uint32Array(1);
      crypto.getRandomValues(random);
      var selected = choices[random[0] % choices.length];
      var img = $("backgroundImage");
      img.addEventListener(
        "error",
        function () {
          img.hidden = true;
        },
        { once: true },
      );
      img.sizes = "100vw";
      img.srcset = selected.variants
        .map(function (variant) {
          return variant.url + " " + variant.width + "w";
        })
        .join(", ");
      img.src = selected.variants[0].url;
      await img.decode();
      img.hidden = false;
      img.dataset.background = selected.id;
      try {
        sessionStorage.setItem("swisspaste:background", selected.id);
      } catch (error) {}
    } catch (error) {
      // The neutral backdrop keeps the app usable when an image cannot load
    }
  }

  function main() {
    cacheEls();
    wireChrome();
    loadBackground();
    $("checkUpdatesBtn").addEventListener("click", checkForUpdates);
    applyI18n();
    fetch("/api/config", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("config");
        return response.json();
      })
      .then(function (config) {
        limits = config;
        updateLimits();
        routeFromPath();
      })
      .catch(function () {
        showLanding();
        els.newBtn.disabled = els.joinBtn.disabled = true;
        showJoinError(t("networkError"));
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
