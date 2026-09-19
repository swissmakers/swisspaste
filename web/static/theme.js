// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Resolve the initial theme before styles render to avoid a bright startup flash

(function () {
  "use strict";
  var theme;
  try {
    theme = localStorage.getItem("swisspaste:theme");
  } catch (error) {}
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#1b1d20" : "#f7f7f5";
})();
