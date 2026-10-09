// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Verify config behavior and resource boundaries
package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInvalidConfigurationFailsClosed(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"SWISSPASTE_MAX_UPLOAD_BYTES", "9223372036854775807GiB"},
		{"SWISSPASTE_MAX_TEXT_BYTES", "nonsense"}, {"SWISSPASTE_MAX_TEXT_BYTES", "65MiB"},
		{"SWISSPASTE_MAX_FILES", "-1"}, {"SWISSPASTE_MAX_SESSION_BYTES", "0"},
		{"SWISSPASTE_SESSION_TTL", "-1s"}, {"SWISSPASTE_FILE_TTL", "forever"},
		{"SWISSPASTE_TRUST_PROXY", "tru"}, {"SWISSPASTE_PEER_INSIGHTS", "yes"},
		{"SWISSPASTE_ALLOWED_ORIGINS", "example.com"}, {"SWISSPASTE_ALLOWED_ORIGINS", "https://example.com/path"},
		{"SWISSPASTE_GEOIP_URL", "file:///etc/passwd"},
		{"SWISSPASTE_PUBLIC_URL", "javascript:alert(1)"},
		{"SWISSPASTE_PUBLIC_URL", "https://example.com/s/SECRET"},
		{"SWISSPASTE_PUBLIC_URL", "https://user:password@example.com"},
		{"SWISSPASTE_PUBLIC_URL", "https://example.com?session=SECRET"},
		{"SWISSPASTE_PUBLIC_URL", "https://example.com#SECRET"},
		{"SWISSPASTE_PUBLIC_URL", "https://:8080"},
		{"SWISSPASTE_CUSTOM_CSS_FILE", "/nonexistent/custom.css"},
		{"SWISSPASTE_CUSTOM_JS_FILE", "/nonexistent/custom.js"},
		{"SWISSPASTE_CSP_EXTRA_SOURCES", "https://a.ch; script-src *"},
		{"SWISSPASTE_CSP_EXTRA_SOURCES", "'unsafe-inline'"},
		{"SWISSPASTE_CSP_EXTRA_SOURCES", "*"},
		{"SWISSPASTE_CSP_EXTRA_SOURCES", "data:"},
		{"SWISSPASTE_CSP_EXTRA_SOURCES", "https://a.ch/path"},
		{"SWISSPASTE_CSP_EXTRA_SOURCES", "https://a.ch 'unsafe-eval'"},
	} {
		t.Run(tc.key+tc.value, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			if _, err := Load(); err == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
}

func TestPublicURLNormalizesRoot(t *testing.T) {
	t.Setenv("SWISSPASTE_PUBLIC_URL", "https://paste.example.com/")
	c, err := Load()
	if err != nil || c.PublicURL != "https://paste.example.com" {
		t.Fatalf("unexpected public origin %v %v", c, err)
	}
}
func TestPrivacyDefault(t *testing.T) {
	t.Setenv("SWISSPASTE_PEER_INSIGHTS", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.PeerInsights {
		t.Fatal("peer insights should be opt-in")
	}
}

func TestCustomAssets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "custom.js")
	if err := os.WriteFile(path, []byte(`console.log("file")`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SWISSPASTE_CUSTOM_CSS", "body{color:red}")
	t.Setenv("SWISSPASTE_CUSTOM_JS_FILE", path)
	t.Setenv("SWISSPASTE_CSP_EXTRA_SOURCES", "https://cdn.example.ch, http://localhost:8081")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.CustomCSS != "body{color:red}" || c.CustomJS != `console.log("file")` || strings.Join(c.CSPExtraSources, " ") != "https://cdn.example.ch http://localhost:8081" {
		t.Fatalf("unexpected custom config %+v", c)
	}

	t.Setenv("SWISSPASTE_CUSTOM_JS", "inline")
	if _, err := Load(); err == nil {
		t.Fatal("inline and file custom JS accepted together")
	}
	t.Setenv("SWISSPASTE_CUSTOM_JS", "")
	t.Setenv("SWISSPASTE_CUSTOM_CSS", strings.Repeat("a", 1<<20+1))
	if _, err := Load(); err == nil {
		t.Fatal("oversized custom CSS accepted")
	}
	t.Setenv("SWISSPASTE_CUSTOM_CSS", "\xff")
	if _, err := Load(); err == nil {
		t.Fatal("invalid UTF-8 custom CSS accepted")
	}
}
