// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Configure browser checks against an isolated local instance
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  use: {
    baseURL: process.env.SWISSPASTE_TEST_URL || "http://127.0.0.1:18080",
    headless: true,
  },
  reporter: "list",
});
