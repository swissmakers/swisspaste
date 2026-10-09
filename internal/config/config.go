// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Package config validates environment settings and resource limits
package config

import (
	"fmt"
	"math"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Config struct {
	MaxSessions           int
	MaxPeers              int
	MaxTotalUploadBytes   int64
	MaxTotalTextBytes     int64
	ListenAddr            string
	PublicURL             string
	DataDir               string
	MaxUploadBytes        int64
	MaxTextBytes          int64
	MaxFilesPerSession    int
	MaxSessionUploadBytes int64
	FileTTL               time.Duration
	SessionTTL            time.Duration
	AllowedOrigins        []string
	TLSCertFile           string
	TLSKeyFile            string
	TrustForwardedHeaders bool
	PeerInsights          bool
	GeoIPURL              string
	CustomCSS             string
	CustomJS              string
	CSPExtraSources       []string
}

func Load() (*Config, error) {
	// Reject malformed limits so operator mistakes cannot silently change resource budgets
	for _, key := range []string{"SWISSPASTE_MAX_UPLOAD_BYTES", "SWISSPASTE_MAX_TEXT_BYTES", "SWISSPASTE_MAX_SESSION_BYTES", "SWISSPASTE_MAX_TOTAL_BYTES", "SWISSPASTE_MAX_TOTAL_TEXT_BYTES"} {
		if v := os.Getenv(key); v != "" {
			if _, err := parseBytes(v); err != nil {
				return nil, fmt.Errorf("%s: %w", key, err)
			}
		}
	}
	for _, key := range []string{"SWISSPASTE_MAX_FILES", "SWISSPASTE_MAX_SESSIONS", "SWISSPASTE_MAX_PEERS"} {
		if v := os.Getenv(key); v != "" {
			n, err := strconv.ParseInt(v, 10, 32)
			if err != nil || n <= 0 {
				return nil, fmt.Errorf("%s must be a positive integer", key)
			}
		}
	}
	for _, key := range []string{"SWISSPASTE_FILE_TTL", "SWISSPASTE_SESSION_TTL"} {
		if v := os.Getenv(key); v != "" {
			d, err := time.ParseDuration(v)
			if err != nil || d <= 0 {
				return nil, fmt.Errorf("%s must be a positive duration", key)
			}
		}
	}
	for _, key := range []string{"SWISSPASTE_TRUST_PROXY", "SWISSPASTE_PEER_INSIGHTS"} {
		if v := os.Getenv(key); v != "" {
			if _, err := strconv.ParseBool(v); err != nil {
				return nil, fmt.Errorf("%s must be a boolean", key)
			}
		}
	}
	c := &Config{
		MaxSessions:           int(envInt("SWISSPASTE_MAX_SESSIONS", 256)),
		MaxPeers:              int(envInt("SWISSPASTE_MAX_PEERS", 32)),
		MaxTotalUploadBytes:   envBytes("SWISSPASTE_MAX_TOTAL_BYTES", 4<<30),
		MaxTotalTextBytes:     envBytes("SWISSPASTE_MAX_TOTAL_TEXT_BYTES", 256<<20),
		ListenAddr:            env("SWISSPASTE_LISTEN", ":8080"),
		PublicURL:             env("SWISSPASTE_PUBLIC_URL", ""),
		DataDir:               env("SWISSPASTE_DATA_DIR", "/var/lib/swisspaste/spool"),
		MaxUploadBytes:        envBytes("SWISSPASTE_MAX_UPLOAD_BYTES", 2<<30),
		MaxTextBytes:          envBytes("SWISSPASTE_MAX_TEXT_BYTES", 4<<20),
		MaxFilesPerSession:    int(envInt("SWISSPASTE_MAX_FILES", 100)),
		MaxSessionUploadBytes: envBytes("SWISSPASTE_MAX_SESSION_BYTES", 16<<30),
		FileTTL:               envDuration("SWISSPASTE_FILE_TTL", 15*time.Minute),
		SessionTTL:            envDuration("SWISSPASTE_SESSION_TTL", 24*time.Hour),
		AllowedOrigins:        envList("SWISSPASTE_ALLOWED_ORIGINS"),
		TLSCertFile:           env("SWISSPASTE_TLS_CERT", ""),
		TLSKeyFile:            env("SWISSPASTE_TLS_KEY", ""),
		TrustForwardedHeaders: envBool("SWISSPASTE_TRUST_PROXY", false),
		PeerInsights:          envBool("SWISSPASTE_PEER_INSIGHTS", false),
		GeoIPURL:              env("SWISSPASTE_GEOIP_URL", ""),
		CSPExtraSources:       envList("SWISSPASTE_CSP_EXTRA_SOURCES"),
	}
	var err error
	if c.CustomCSS, err = envAsset("SWISSPASTE_CUSTOM_CSS"); err != nil {
		return nil, err
	}
	if c.CustomJS, err = envAsset("SWISSPASTE_CUSTOM_JS"); err != nil {
		return nil, err
	}

	if c.PublicURL != "" {
		u, err := url.Parse(c.PublicURL)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
			return nil, fmt.Errorf("SWISSPASTE_PUBLIC_URL must be an HTTP(S) origin without credentials, query or fragment")
		}
		c.PublicURL = strings.TrimSuffix(c.PublicURL, "/")
	}
	if (c.TLSCertFile == "") != (c.TLSKeyFile == "") {
		return nil, fmt.Errorf("SWISSPASTE_TLS_CERT and SWISSPASTE_TLS_KEY must be set together")
	}
	if c.MaxUploadBytes <= 0 {
		return nil, fmt.Errorf("SWISSPASTE_MAX_UPLOAD_BYTES must be positive")
	}
	if c.MaxTextBytes <= 0 {
		return nil, fmt.Errorf("SWISSPASTE_MAX_TEXT_BYTES must be positive")
	}
	if c.MaxTextBytes > 64<<20 {
		return nil, fmt.Errorf("SWISSPASTE_MAX_TEXT_BYTES must not exceed 64MiB")
	}
	for _, origin := range c.AllowedOrigins {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, fmt.Errorf("SWISSPASTE_ALLOWED_ORIGINS must contain complete HTTP(S) origins without paths")
		}
	}
	for _, source := range c.CSPExtraSources {
		u, err := url.Parse(source)
		if strings.ContainsAny(source, ";,'\" \t\r\n") || err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
			return nil, fmt.Errorf("SWISSPASTE_CSP_EXTRA_SOURCES must contain complete HTTP(S) origins without paths")
		}
	}
	if c.GeoIPURL != "" {
		u, err := url.Parse(strings.ReplaceAll(c.GeoIPURL, "{ip}", "8.8.8.8"))
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
			return nil, fmt.Errorf("SWISSPASTE_GEOIP_URL must be an HTTP(S) URL without credentials")
		}
	}
	return c, nil
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// Reads inline content from key or a file named by key_FILE, never both
func envAsset(key string) (string, error) {
	const maxAssetBytes = 1 << 20
	inline, path := os.Getenv(key), os.Getenv(key+"_FILE")
	if inline != "" && path != "" {
		return "", fmt.Errorf("%s and %s_FILE must not be set together", key, key)
	}
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("%s_FILE: %w", key, err)
		}
		inline = string(b)
	}
	if len(inline) > maxAssetBytes {
		return "", fmt.Errorf("%s must not exceed 1MiB", key)
	}
	if !utf8.ValidString(inline) {
		return "", fmt.Errorf("%s must be valid UTF-8", key)
	}
	return inline, nil
}

func envBool(key string, def bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
	}
	return def
}

func envInt(key string, def int64) int64 {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err == nil {
			return n
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err == nil {
			return d
		}
	}
	return def
}

func envList(key string) []string {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func envBytes(key string, def int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, _ := parseBytes(v)
	return n
}

func parseBytes(v string) (int64, error) {
	v = strings.TrimSpace(v)
	mult := int64(1)
	for suffix, factor := range map[string]int64{"GiB": 1 << 30, "MiB": 1 << 20, "KiB": 1 << 10} {
		if strings.HasSuffix(v, suffix) {
			mult = factor
			v = strings.TrimSuffix(v, suffix)
			break
		}
	}
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil || n <= 0 || n > math.MaxInt64/mult {
		return 0, fmt.Errorf("must be a positive byte count without overflow")
	}
	return n * mult, nil
}
