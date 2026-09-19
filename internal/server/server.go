// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Package server serves the application and enforces HTTP access boundaries
package server

import (
	"encoding/json"
	"errors"
	"html"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gorilla/websocket"
	useragent "github.com/mileusna/useragent"

	"github.com/swissmakers/swisspaste/internal/config"
	"github.com/swissmakers/swisspaste/internal/geoip"
	"github.com/swissmakers/swisspaste/internal/release"
	"github.com/swissmakers/swisspaste/internal/session"
)

type Server struct {
	version     string
	license     []byte
	updates     *release.Checker
	cfg         *config.Config
	mgr         *session.Manager
	log         *slog.Logger
	index       []byte
	staticFS    fs.FS
	upgrader    websocket.Upgrader
	geo         geoip.Resolver
	uploads     chan struct{}
	connections chan struct{}
	createMu    sync.Mutex
	createAt    time.Time
	createCount int
	queuedBytes atomic.Int64
}

func New(cfg *config.Config, mgr *session.Manager, log *slog.Logger, index []byte, staticFS fs.FS, version string, license []byte) *Server {
	publicMeta := ""
	if cfg.PublicURL != "" {
		root := html.EscapeString(cfg.PublicURL + "/")
		preview := html.EscapeString(cfg.PublicURL + "/static/img/previews/desktop.png")
		publicMeta = `<link rel="canonical" href="` + root + `" />` +
			`<meta property="og:url" content="` + root + `" />` +
			`<meta property="og:image" content="` + preview + `" />` +
			`<meta property="og:image:width" content="1280" />` +
			`<meta property="og:image:height" content="800" />` +
			`<meta property="og:image:alt" content="swissPaste shared clipboard" />` +
			`<meta name="twitter:image" content="` + preview + `" />` +
			`<meta name="twitter:image:alt" content="swissPaste shared clipboard" />`
	}
	page := strings.NewReplacer("{{VERSION}}", html.EscapeString(version), "{{PUBLIC_META}}", publicMeta).Replace(string(index))
	s := &Server{
		cfg:         cfg,
		uploads:     make(chan struct{}, 8),
		connections: make(chan struct{}, 256),
		mgr:         mgr,
		log:         log,
		index:       []byte(page),
		version:     version,
		license:     license,
		updates:     release.New(version),
		staticFS:    staticFS,
		geo:         geoip.New(cfg.GeoIPURL),
	}
	s.upgrader = websocket.Upgrader{
		HandshakeTimeout: 10 * time.Second,
		ReadBufferSize:   4096,
		WriteBufferSize:  4096,
		CheckOrigin:      s.checkOrigin,
	}
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /s/{code}", s.handleIndex)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})

	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"version": s.version, "repository": release.Repository, "maxUploadBytes": s.cfg.MaxUploadBytes, "maxTextBytes": s.cfg.MaxTextBytes, "fileTtlMs": s.cfg.FileTTL.Milliseconds(), "sessionTtlMs": s.cfg.SessionTTL.Milliseconds(), "peerInsights": s.cfg.PeerInsights})
	})
	mux.HandleFunc("GET /api/updates", func(w http.ResponseWriter, r *http.Request) {
		if !s.checkOrigin(r) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeJSONError(w, http.StatusForbidden, "origin not allowed")
			return
		}
		writeJSON(w, http.StatusOK, s.updates.Check())
	})
	mux.HandleFunc("GET /license", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(s.license)
	})
	mux.HandleFunc("POST /api/sessions", s.handleCreate)
	mux.HandleFunc("GET /api/sessions/{code}", s.handleCheck)
	mux.HandleFunc("POST /api/sessions/{code}/files", s.handleUpload)
	mux.HandleFunc("GET /api/sessions/{code}/files/{id}", s.handleDownload)
	mux.HandleFunc("DELETE /api/sessions/{code}/files/{id}", s.handleDeleteFile)

	mux.HandleFunc("GET /ws/{code}", s.handleWS)

	mux.Handle("GET /static/", s.staticHandler())
	mux.HandleFunc("GET /favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/static/img/logo/favicon.ico", http.StatusTemporaryRedirect)
	})

	return s.securityHeaders(mux)
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	const csp = "default-src 'self'; " +
		"script-src 'self'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data: blob:; " +
		"media-src blob:; " +
		"worker-src 'self'; " +
		"font-src 'self'; " +
		"connect-src 'self'; " +
		"object-src 'none'; " +
		"base-uri 'none'; " +
		"form-action 'self'; " +
		"frame-ancestors 'none'"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if s.requestScheme(r) == "https" {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		h.Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodHead && (!s.checkOrigin(r) || (r.Header.Get("Origin") == "" && r.Header.Get("Sec-Fetch-Site") == "cross-site")) {
			writeJSONError(w, http.StatusForbidden, "origin not allowed")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requestScheme(r *http.Request) string {
	if r.TLS != nil || (s.cfg.TrustForwardedHeaders && r.Header.Get("X-Forwarded-Proto") == "https") {
		return "https"
	}
	return "http"
}

func (s *Server) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if len(s.cfg.AllowedOrigins) > 0 {
		for _, a := range s.cfg.AllowedOrigins {
			if strings.EqualFold(a, origin) {
				return true
			}
		}
		return false
	}
	return strings.EqualFold(u.Host, r.Host) && u.Scheme == s.requestScheme(r)
}

func (s *Server) buildPeerMeta(r *http.Request) session.PeerMeta {
	meta := session.PeerMeta{
		ID:       session.NewPeerID(),
		JoinedAt: time.Now().UnixMilli(),
	}
	if !s.cfg.PeerInsights {
		return meta
	}

	meta.IP = s.clientIP(r)

	if raw := r.Header.Get("User-Agent"); raw != "" {
		if len(raw) > 512 {
			raw = raw[:512]
		}
		ua := useragent.Parse(raw)
		meta.OS = ua.OS
		meta.OSVersion = ua.OSVersion
		meta.Browser = ua.Name
		meta.BrowserVersion = ua.Version
		meta.Device = ua.Device
		meta.Mobile = ua.Mobile || ua.Tablet
		meta.Bot = ua.Bot
		if len(raw) > 512 {
			raw = raw[:512]
		}
		meta.UserAgent = raw
	}

	if loc, ok := s.geo.Lookup(meta.IP); ok {
		meta.Country = loc.Country
		meta.CountryCode = loc.CountryCode
		meta.Region = loc.Region
		meta.City = loc.City
		meta.Lat = loc.Lat
		meta.Lon = loc.Lon
	}
	return meta
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustForwardedHeaders {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if i := strings.IndexByte(xff, ','); i >= 0 {
				xff = xff[:i]
			}
			if ip := net.ParseIP(strings.TrimSpace(xff)); ip != nil {
				return ip.String()
			}
		}
		if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); ip != nil {
			return ip.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if code := r.PathValue("code"); code != "" && !session.ValidCode(code) {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(s.index)
}

func (s *Server) staticHandler() http.Handler {
	fileServer := http.StripPrefix("/static/", http.FileServer(http.FS(s.staticFS)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := path.Clean(strings.TrimPrefix(r.URL.Path, "/static/"))
		if rel == "." || rel == "/" || strings.HasPrefix(rel, "..") {
			http.NotFound(w, r)
			return
		}
		f, err := s.staticFS.Open(rel)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		info, statErr := f.Stat()
		_ = f.Close()
		if statErr != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasSuffix(rel, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
		}
		if strings.HasPrefix(rel, "img/bg_live/") && strings.HasSuffix(rel, ".webp") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	s.createMu.Lock()
	if time.Since(s.createAt) >= time.Minute {
		s.createAt = time.Now()
		s.createCount = 0
	}
	allowed := s.createCount < 60
	if allowed {
		s.createCount++
	}
	s.createMu.Unlock()
	if !allowed {
		w.Header().Set("Retry-After", "60")
		writeJSONError(w, http.StatusTooManyRequests, "too many sessions created; try again shortly")
		return
	}
	sess, err := s.mgr.Create()
	if err != nil {
		s.log.Error("create session", "err", err)
		writeJSONError(w, http.StatusServiceUnavailable, "could not create session")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"code":      sess.Code,
		"expiresAt": sess.CreatedAt.Add(s.cfg.SessionTTL).UnixMilli(),
	})
}

func (s *Server) handleCheck(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	sess, err := s.mgr.Get(code)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code":      sess.Code,
		"expiresAt": sess.CreatedAt.Add(s.cfg.SessionTTL).UnixMilli(),
	})
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	select {
	case s.uploads <- struct{}{}:
		defer func() { <-s.uploads }()
	default:
		writeJSONError(w, http.StatusServiceUnavailable, "upload capacity reached")
		return
	}
	code := r.PathValue("code")
	sess, err := s.mgr.Get(code)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "session not found")
		return
	}
	if r.ContentLength > s.cfg.MaxUploadBytes {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "file exceeds maximum size")
		return
	}
	name := sanitizeFilename(decodeHeaderFilename(r.Header.Get("X-Filename")))
	if name == "" {
		name = "upload.bin"
	}

	declared := r.ContentLength
	if declared < 0 {
		declared = s.cfg.MaxUploadBytes
	}
	reservation, err := sess.ReserveFile(declared)
	if err != nil {
		switch {
		case errors.Is(err, session.ErrCapacity):
			writeJSONError(w, http.StatusServiceUnavailable, "server storage limit reached")
		case errors.Is(err, session.ErrTooManyFiles):
			writeJSONError(w, http.StatusConflict, "too many files in this session")
		case errors.Is(err, session.ErrSessionFull):
			writeJSONError(w, http.StatusRequestEntityTooLarge, "session storage limit reached")
		default:
			writeJSONError(w, http.StatusConflict, "upload rejected")
		}
		return
	}

	defer reservation.Release()
	id, err := session.NewFileID()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	diskPath := s.mgr.SpoolPath(sess.Code, id)
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(diskPath)
		}
	}()

	dst, err := os.OpenFile(diskPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		s.log.Error("spool open", "err", err)
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}

	limit := declared
	body := http.MaxBytesReader(w, r.Body, limit)
	written, copyErr := io.Copy(dst, body)
	closeErr := dst.Close()

	if copyErr != nil || closeErr != nil {
		_ = os.Remove(diskPath)
		var maxErr *http.MaxBytesError
		if errors.As(copyErr, &maxErr) {
			writeJSONError(w, http.StatusRequestEntityTooLarge, "file exceeds maximum size")
			return
		}
		s.log.Warn("upload failed", "err", copyErr, "closeErr", closeErr)
		writeJSONError(w, http.StatusBadRequest, "upload failed")
		return
	}

	f := s.mgr.MakeFile(code, id, name, written)
	if err := reservation.Commit(f); err != nil {
		writeJSONError(w, http.StatusConflict, "session expired or upload rejected")
		return
	}
	committed = true

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":        f.ID,
		"name":      f.Name,
		"size":      f.Size,
		"expiresAt": f.UploadedAt.Add(s.cfg.FileTTL).UnixMilli(),
	})
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	id := r.PathValue("id")
	sess, err := s.mgr.Get(code)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, ok := sess.File(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(f.DiskPath())
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", contentDisposition(f.Name))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, f.Name, info.ModTime(), file)
}

func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	id := r.PathValue("id")
	sess, err := s.mgr.Get(code)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if !sess.DeleteFile(id) {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeHeaderFilename(v string) string {
	if v == "" {
		return ""
	}
	if dec, err := url.PathUnescape(v); err == nil {
		return dec
	}
	return v
}

func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(name)
	if name == "." || name == "/" || name == ".." {
		return ""
	}
	var b strings.Builder
	for _, r := range name {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			continue
		}
		b.WriteRune(r)
	}
	out := strings.TrimSpace(b.String())
	if len(out) > 255 {
		out = out[:255]
		for !utf8.ValidString(out) {
			out = out[:len(out)-1]
		}
	}
	return out
}

func contentDisposition(name string) string {
	return mime.FormatMediaType("attachment", map[string]string{"filename": name})
}
