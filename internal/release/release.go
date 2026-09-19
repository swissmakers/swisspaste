// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Package release checks public GitHub tags without sending session data
package release

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const Repository = "https://github.com/swissmakers/swisspaste"
const tagsURL = "https://api.github.com/repos/swissmakers/swisspaste/tags"

var stableTag = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

type Result struct {
	Current   string    `json:"current"`
	Latest    string    `json:"latest,omitempty"`
	Status    string    `json:"status"`
	URL       string    `json:"url,omitempty"`
	CheckedAt time.Time `json:"checkedAt"`
}

type Checker struct {
	mu       sync.Mutex
	current  string
	client   *http.Client
	endpoint string
	cached   Result
	expires  time.Time
}

func New(current string) *Checker {
	return &Checker{current: current, endpoint: tagsURL, client: &http.Client{
		Timeout:       8 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func parseVersion(tag string) ([3]uint64, bool) {
	var version [3]uint64
	parts := stableTag.FindStringSubmatch(tag)
	if parts == nil {
		return version, false
	}
	for i := range version {
		n, err := strconv.ParseUint(parts[i+1], 10, 64)
		if err != nil {
			return version, false
		}
		version[i] = n
	}
	return version, true
}

func newer(a, b [3]uint64) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

// A shared cache prevents repeated clicks from exhausting the GitHub API quota
func (c *Checker) Check() Result {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Now().Before(c.expires) {
		return c.cached
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	result := c.fetch(ctx)
	result.Current = c.current
	result.CheckedAt = time.Now().UTC()
	c.cached = result
	c.expires = time.Now().Add(time.Hour)
	if result.Status == "unavailable" {
		c.expires = time.Now().Add(time.Minute)
	}
	return result
}

func (c *Checker) fetch(ctx context.Context) Result {
	current, ok := parseVersion(c.current)
	if !ok {
		return Result{Status: "unavailable"}
	}
	var latest [3]uint64
	var latestTag string
	for page := 1; page <= 10; page++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s?per_page=100&page=%d", c.endpoint, page), nil)
		if err != nil {
			return Result{Status: "unavailable"}
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		req.Header.Set("User-Agent", "swissPaste-update-check")
		resp, err := c.client.Do(req)
		if err != nil {
			return Result{Status: "unavailable"}
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
		_ = resp.Body.Close()
		if err != nil || len(data) > 1<<20 || resp.StatusCode != http.StatusOK {
			return Result{Status: "unavailable"}
		}
		var tags []struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(data, &tags); err != nil || tags == nil {
			return Result{Status: "unavailable"}
		}
		for _, tag := range tags {
			version, valid := parseVersion(tag.Name)
			if valid && (latestTag == "" || newer(version, latest)) {
				latest, latestTag = version, tag.Name
			}
		}
		if strings.Contains(resp.Header.Get("Link"), `rel="next"`) {
			continue
		}
		if latestTag == "" {
			return Result{Status: "no_releases"}
		}
		status := "current"
		if newer(latest, current) {
			status = "available"
		}
		return Result{Status: status, Latest: strings.TrimPrefix(latestTag, "v"), URL: Repository + "/tree/" + latestTag}
	}
	return Result{Status: "unavailable"}
}
