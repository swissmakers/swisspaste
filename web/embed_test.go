// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Keep source photographs out of public runtime assets
package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/png"
	"io/fs"
	"strings"
	"testing"
)

func TestRuntimeBackgroundsExcludeOriginals(t *testing.T) {
	static := Static()
	if _, err := fs.Stat(static, "img/bg_source"); err == nil {
		t.Fatal("original photographs are embedded")
	}
	data, err := fs.ReadFile(static, "img/bg_live/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Images []struct {
			Variants []struct {
				URL string `json:"url"`
			} `json:"variants"`
		} `json:"images"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, image := range manifest.Images {
		for _, variant := range image.Variants {
			if !strings.HasPrefix(variant.URL, "/static/img/bg_live/") {
				t.Fatalf("unexpected background URL %q", variant.URL)
			}
			if _, err := fs.Stat(static, strings.TrimPrefix(variant.URL, "/static/")); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestInstallManifestDoesNotRetainSessionCodes(t *testing.T) {
	static := Static()
	for _, name := range []string{"img/bg_source", "img/logo/logo.png", "favicon.svg"} {
		if _, err := fs.Stat(static, name); err == nil {
			t.Fatalf("source or placeholder is embedded %s", name)
		}
	}
	data, err := fs.ReadFile(static, "app.webmanifest")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		ID          string `json:"id"`
		StartURL    string `json:"start_url"`
		Scope       string `json:"scope"`
		Display     string `json:"display"`
		Screenshots []struct {
			Src        string `json:"src"`
			Sizes      string `json:"sizes"`
			Type       string `json:"type"`
			FormFactor string `json:"form_factor"`
		} `json:"screenshots"`
		Icons []struct {
			Src     string `json:"src"`
			Sizes   string `json:"sizes"`
			Purpose string `json:"purpose"`
		} `json:"icons"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.ID != "/" || manifest.StartURL != "/" || manifest.Scope != "/" || manifest.Display != "standalone" {
		t.Fatalf("unsafe installed launch target %+v", manifest)
	}
	if len(manifest.Icons) != 4 {
		t.Fatal("missing installation icons")
	}
	if len(manifest.Screenshots) != 2 {
		t.Fatal("missing installation previews")
	}
	factors := map[string]bool{}
	for _, shot := range manifest.Screenshots {
		if !strings.HasPrefix(shot.Src, "/static/img/previews/") || shot.Type != "image/png" {
			t.Fatalf("invalid installation preview %+v", shot)
		}
		data, err := fs.ReadFile(static, strings.TrimPrefix(shot.Src, "/static/"))
		if err != nil {
			t.Fatal(err)
		}
		size, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprintf("%dx%d", size.Width, size.Height) != shot.Sizes || size.Width < 320 || size.Height < 320 || size.Width > 3840 || size.Height > 3840 || float64(max(size.Width, size.Height))/float64(min(size.Width, size.Height)) > 2.3 {
			t.Fatalf("invalid preview dimensions %+v", shot)
		}
		factors[shot.FormFactor] = true
	}
	if !factors["wide"] || !factors["narrow"] {
		t.Fatal("installation previews must cover desktop and mobile")
	}
	for _, icon := range manifest.Icons {
		if !strings.HasPrefix(icon.Src, "/static/img/logo/") {
			t.Fatalf("invalid icon path %q", icon.Src)
		}
		data, err := fs.ReadFile(static, strings.TrimPrefix(icon.Src, "/static/"))
		if err != nil {
			t.Fatal(err)
		}
		size, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprintf("%dx%d", size.Width, size.Height) != icon.Sizes {
			t.Fatal("icon dimensions differ from manifest")
		}
	}
}
