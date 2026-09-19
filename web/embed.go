// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Package web embeds runtime assets without the original photographs
package web

import (
	"embed"
	"io/fs"
)

//go:embed static/*.js static/*.css static/*.txt static/*.webmanifest static/pdf static/img/bg_live static/img/previews static/img/logo/logo-*.png static/img/logo/icon-*.png static/img/logo/apple-touch-icon.png static/img/logo/favicon.ico templates/index.html
var assets embed.FS

func Index() []byte {
	b, err := assets.ReadFile("templates/index.html")
	if err != nil {
		panic("swisspaste: index.html not embedded: " + err.Error())
	}
	return b
}

func Static() fs.FS {
	sub, err := fs.Sub(assets, "static")
	if err != nil {
		panic("swisspaste: static assets not embedded: " + err.Error())
	}
	return sub
}
