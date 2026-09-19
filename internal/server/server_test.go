// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Verify server behavior and resource boundaries
package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gorilla/websocket"
	"github.com/swissmakers/swisspaste/internal/config"
	"github.com/swissmakers/swisspaste/internal/session"
)

func fixture(t *testing.T) (*Server, *session.Session) {
	t.Helper()
	cfg := &config.Config{MaxUploadBytes: 8, MaxTextBytes: 32, FileTTL: time.Hour, SessionTTL: time.Hour}
	mgr, err := session.NewManager(t.TempDir(), session.Limits{MaxTextBytes: 32, MaxFilesPerSession: 2, MaxSessionUploadBytes: 10, FileTTL: cfg.FileTTL, SessionTTL: cfg.SessionTTL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mgr.Shutdown)
	sess, _ := mgr.Create()
	return New(cfg, mgr, slog.New(slog.NewTextHandler(io.Discard, nil)), []byte("index"), fstest.MapFS{}, "1.0.0", []byte("license")), sess
}

func TestPublicMetadataDoesNotReflectSessionOrHost(t *testing.T) {
	s, sess := fixture(t)
	for _, publicURL := range []string{"", "https://paste.example.com"} {
		s.cfg.PublicURL = publicURL
		app := New(s.cfg, s.mgr, s.log, []byte(`<head>{{PUBLIC_META}}</head>{{VERSION}}`), s.staticFS, "1.0.0", nil)
		var home string
		for _, path := range []string{"/", "/s/" + sess.Code + "?secret=test"} {
			r := httptest.NewRequest("GET", "https://untrusted.example"+path, nil)
			r.Header.Set("X-Forwarded-Host", "injected.example")
			w := httptest.NewRecorder()
			app.Handler().ServeHTTP(w, r)
			body := w.Body.String()
			for _, secret := range []string{sess.Code, "untrusted.example", "injected.example", "secret=test", "{{PUBLIC_META}}"} {
				if strings.Contains(body, secret) {
					t.Fatalf("metadata contains request data %q", secret)
				}
			}
			if path == "/" {
				home = body
			} else if body != home {
				t.Fatal("session preview differs from public preview")
			}
			if publicURL == "" && strings.Contains(body, "canonical") {
				t.Fatal("canonical URL emitted without configured origin")
			}
			if publicURL != "" && !strings.Contains(body, `href="https://paste.example.com/"`) {
				t.Fatal("configured canonical URL missing")
			}
		}
	}
}

func TestWebSocketLanguageProtocol(t *testing.T) {
	s, sess := fixture(t)
	host := httptest.NewServer(s.Handler())
	defer host.Close()
	connect := func() *websocket.Conn {
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(host.URL, "http")+"/ws/"+sess.Code, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		c.SetReadDeadline(time.Now().Add(5 * time.Second))
		return c
	}
	next := func(c *websocket.Conn, kind string) map[string]any {
		for {
			var message map[string]any
			if err := c.ReadJSON(&message); err != nil {
				t.Fatal(err)
			}
			if message["type"] == kind {
				return message
			}
		}
	}
	a, b := connect(), connect()
	if got := next(a, "init")["language"]; got != "" {
		t.Fatal(got)
	}
	next(b, "init")
	if err := a.WriteJSON(map[string]string{"type": "language", "language": "text/x-go"}); err != nil {
		t.Fatal(err)
	}
	for _, peer := range []*websocket.Conn{a, b} {
		if got := next(peer, "language")["language"]; got != "text/x-go" {
			t.Fatal(got)
		}
	}
	if err := a.WriteJSON(map[string]string{"type": "language", "language": "invalid"}); err != nil {
		t.Fatal(err)
	}
	next(a, "language_error")
	if err := a.WriteJSON(map[string]string{"type": "text", "content": "still connected"}); err != nil {
		t.Fatal(err)
	}
	if got := next(a, "ack")["content"]; got != "still connected" {
		t.Fatal(got)
	}
	c := connect()
	snapshot := next(c, "init")
	if snapshot["language"] != "text/x-go" || snapshot["content"] != "still connected" {
		t.Fatal(snapshot)
	}
}
func TestOriginProtectionAndNoStore(t *testing.T) {
	s, sess := fixture(t)
	for _, origin := range []string{"http://evil.test", "https://example.com", "null", "http://example.com/path", "http://user@example.com"} {
		r := httptest.NewRequest("POST", "http://example.com/api/sessions", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("accepted origin %q: %d", origin, w.Code)
		}
	}
	for _, path := range []string{"/", "/api/sessions/" + sess.Code, "/api/config"} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("cacheable sensitive route %s", path)
		}
	}
	s.cfg.TrustForwardedHeaders = true
	r := httptest.NewRequest("GET", "http://example.com/", nil)
	r.Header.Set("Origin", "https://example.com")
	r.Header.Set("X-Forwarded-Proto", "https")
	if !s.checkOrigin(r) {
		t.Fatal("trusted TLS proxy rejected")
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Header().Get("Strict-Transport-Security") == "" {
		t.Fatal("no HSTS behind TLS proxy")
	}
}
func TestUploadLimitsUnknownLengthsAndCleanup(t *testing.T) {
	s, sess := fixture(t)
	route := "/api/sessions/" + sess.Code + "/files"
	upload := func(content string, unknown bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", route, strings.NewReader(content))
		if unknown {
			r.ContentLength = -1
		}
		r.Header.Set("X-Filename", "a%2Bb%27.txt")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	if w := upload("123456789", true); w.Code != 413 {
		t.Fatalf("oversize chunked upload: %d", w.Code)
	}
	w := upload("12345678", true)
	if w.Code != 201 {
		t.Fatalf("reservation leaked: %d %s", w.Code, w.Body.String())
	}
	var f struct{ ID, Name string }
	if err := json.Unmarshal(w.Body.Bytes(), &f); err != nil {
		t.Fatal(err)
	}
	if f.Name != "a+b'.txt" {
		t.Fatalf("filename changed: %q", f.Name)
	}
	if w := upload("123", false); w.Code != 413 {
		t.Fatal("session quota bypass")
	}
	if w := upload("", false); w.Code != 201 {
		t.Fatal("empty file rejected")
	}
	if w := upload("", false); w.Code != 409 {
		t.Fatal("file count bypass")
	}
	dl := httptest.NewRecorder()
	s.Handler().ServeHTTP(dl, httptest.NewRequest("GET", route+"/"+f.ID, nil))
	_, params, err := mime.ParseMediaType(dl.Header().Get("Content-Disposition"))
	if err != nil || params["filename"] != f.Name {
		t.Fatal("unsafe filename header", err)
	}
	if !bytes.Equal(dl.Body.Bytes(), []byte("12345678")) {
		t.Fatal("download mismatch")
	}
	if dl.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("download cached")
	}
	if _, err := os.Stat(s.mgr.SpoolPath(sess.Code, f.ID)); err != nil {
		t.Fatal(err)
	}
}
func TestWebsocketPrivacyEscapedTextAndAck(t *testing.T) {
	s, sess := fixture(t)
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+sess.Code, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	var init map[string]any
	if err = ws.ReadJSON(&init); err != nil {
		t.Fatal(err)
	}
	_ = ws.WriteJSON(map[string]any{"type": "hello", "timezone": "secret", "languages": []string{"secret"}})
	text := strings.Repeat("\x01", 32)
	_ = ws.WriteJSON(map[string]string{"type": "text", "content": text})
	for {
		var msg map[string]any
		if err = ws.ReadJSON(&msg); err != nil {
			t.Fatal(err)
		}
		if msg["type"] == "ack" {
			break
		}
		data, _ := json.Marshal(msg)
		if strings.Contains(string(data), "secret") {
			t.Fatal("private hello metadata leaked")
		}
	}
	second, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+sess.Code, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	_ = second.SetReadDeadline(time.Now().Add(5 * time.Second))
	var snapshot map[string]any
	if err = second.ReadJSON(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot["content"] != text {
		t.Fatal("escaped text not synchronized")
	}
	data, _ := json.Marshal(snapshot)
	if strings.Contains(string(data), "secret") {
		t.Fatal("private metadata in snapshot")
	}
	_ = ws.WriteJSON(map[string]string{"type": "text", "content": strings.Repeat("x", 33)})
	for {
		var msg map[string]any
		if err = ws.ReadJSON(&msg); err != nil {
			t.Fatal(err)
		}
		if msg["type"] == "error" {
			break
		}
	}
}
func TestForwardedAddressValidation(t *testing.T) {
	s, _ := fixture(t)
	s.cfg.TrustForwardedHeaders = true
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.1:4321"
	r.Header.Set("X-Forwarded-For", "not-an-ip")
	if got := s.clientIP(r); got != "192.0.2.1" {
		t.Fatal(got)
	}
}

func TestReleaseMetadataAndOriginBoundary(t *testing.T) {
	s, _ := fixture(t)
	handler := s.Handler()
	for _, tc := range []struct{ path, content string }{
		{"/api/config", `"version":"1.0.0"`},
		{"/license", "license"},
	} {
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if r.Code != http.StatusOK || !strings.Contains(r.Body.String(), tc.content) || r.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("unexpected response %d %s", r.Code, r.Body.String())
		}
	}
	r := httptest.NewRequest(http.MethodGet, "/api/updates", nil)
	r.Header.Set("Origin", "https://untrusted.invalid")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("cross-site update check returned %d", w.Code)
	}
}

func TestInstallationMetadataAndGeneratedAssetCaching(t *testing.T) {
	s, _ := fixture(t)
	s.staticFS = fstest.MapFS{
		"app.webmanifest":      {Data: []byte(`{"start_url":"/"}`)},
		"img/bg_live/123.webp": {Data: []byte("image")},
		"img/logo/favicon.ico": {Data: []byte("icon")},
	}
	for _, tc := range []struct{ path, mime, cache string }{
		{"/static/app.webmanifest", "application/manifest+json; charset=utf-8", "no-cache"},
		{"/static/img/bg_live/123.webp", "image/webp", "public, max-age=31536000, immutable"},
	} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != 200 || w.Header().Get("Content-Type") != tc.mime || w.Header().Get("Cache-Control") != tc.cache {
			t.Fatalf("incorrect metadata for %s %+v", tc.path, w)
		}
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/favicon.ico", nil))
	if w.Code != http.StatusTemporaryRedirect || w.Header().Get("Location") != "/static/img/logo/favicon.ico" {
		t.Fatalf("invalid favicon redirect %+v", w)
	}
}
