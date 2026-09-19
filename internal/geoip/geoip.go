// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Package geoip resolves optional participant locations with bounded requests
package geoip

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Location struct {
	Country     string  `json:"country,omitempty"`
	CountryCode string  `json:"countryCode,omitempty"`
	Region      string  `json:"region,omitempty"`
	City        string  `json:"city,omitempty"`
	Lat         float64 `json:"lat,omitempty"`
	Lon         float64 `json:"lon,omitempty"`
}

type Resolver interface {
	Lookup(ip string) (Location, bool)
}

type Nop struct{}

func (Nop) Lookup(string) (Location, bool) { return Location{}, false }

type httpResolver struct {
	base   string
	client *http.Client

	mu    sync.Mutex
	cache map[string]cacheEntry
	ttl   time.Duration
}

type cacheEntry struct {
	loc Location
	ok  bool
	at  time.Time
}

func New(endpoint string) Resolver {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return Nop{}
	}
	return &httpResolver{
		base:   endpoint,
		client: &http.Client{Timeout: 2500 * time.Millisecond, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		cache:  make(map[string]cacheEntry),
		ttl:    30 * time.Minute,
	}
}

type rawLocation struct {
	Status       string  `json:"status"`
	Country      string  `json:"country"`
	CountryName  string  `json:"country_name"`
	CountryCode  string  `json:"countryCode"`
	CountryCode2 string  `json:"country_code"`
	Region       string  `json:"regionName"`
	RegionAlt    string  `json:"region"`
	City         string  `json:"city"`
	Lat          float64 `json:"lat"`
	Latitude     float64 `json:"latitude"`
	Lon          float64 `json:"lon"`
	Longitude    float64 `json:"longitude"`
}

func (r *httpResolver) Lookup(ip string) (Location, bool) {
	if ip == "" || !isPublicIP(ip) {
		return Location{}, false
	}

	r.mu.Lock()
	if e, ok := r.cache[ip]; ok && time.Since(e.at) < r.ttl {
		r.mu.Unlock()
		return e.loc, e.ok
	}
	r.mu.Unlock()

	loc, ok := r.fetch(ip)

	r.mu.Lock()
	if len(r.cache) >= 4096 {
		clear(r.cache)
	}
	r.cache[ip] = cacheEntry{loc: loc, ok: ok, at: time.Now()}
	r.mu.Unlock()
	return loc, ok
}

func (r *httpResolver) fetch(ip string) (Location, bool) {
	url := r.base
	if !strings.HasSuffix(url, "/") && !strings.Contains(url, "{ip}") {
		url += "/"
	}
	if strings.Contains(url, "{ip}") {
		url = strings.ReplaceAll(url, "{ip}", ip)
	} else {
		url += ip
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Location{}, false
	}
	req.Header.Set("Accept", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return Location{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Location{}, false
	}

	var raw rawLocation
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&raw); err != nil {
		return Location{}, false
	}
	if raw.Status != "" && !strings.EqualFold(raw.Status, "success") {
		return Location{}, false
	}

	loc := Location{
		Country:     firstNonEmpty(raw.Country, raw.CountryName),
		CountryCode: firstNonEmpty(raw.CountryCode, raw.CountryCode2),
		Region:      firstNonEmpty(raw.Region, raw.RegionAlt),
		City:        raw.City,
		Lat:         firstNonZero(raw.Lat, raw.Latitude),
		Lon:         firstNonZero(raw.Lon, raw.Longitude),
	}
	if loc == (Location{}) {
		return Location{}, false
	}
	return loc, true
}

func isPublicIP(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	if !parsed.IsGlobalUnicast() || parsed.IsLoopback() || parsed.IsPrivate() || parsed.IsUnspecified() ||
		parsed.IsLinkLocalUnicast() || parsed.IsLinkLocalMulticast() {
		return false
	}
	return true
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstNonZero(vals ...float64) float64 {
	for _, v := range vals {
		if v != 0 {
			return v
		}
	}
	return 0
}

func (l Location) String() string {
	parts := make([]string, 0, 2)
	if l.City != "" {
		parts = append(parts, l.City)
	}
	if l.CountryCode != "" {
		parts = append(parts, l.CountryCode)
	} else if l.Country != "" {
		parts = append(parts, l.Country)
	}
	return strings.Join(parts, ", ")
}
