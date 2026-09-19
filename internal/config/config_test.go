// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Verify config behavior and resource boundaries
package config

import "testing"

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
