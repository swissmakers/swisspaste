// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Exercise release ordering and bounded GitHub requests with isolated responses
package release

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

func TestVersionOrdering(t *testing.T) {
	for _, tag := range []string{"v1.0.0-rc1", "1.01.0", "1.0", "1.0.0+build", "other", "v18446744073709551616.0.0"} {
		if _, ok := parseVersion(tag); ok {
			t.Errorf("accepted %q", tag)
		}
	}
	a, _ := parseVersion("v1.10.0")
	b, _ := parseVersion("1.9.99")
	if !newer(a, b) || newer(b, a) || newer(a, a) {
		t.Fatal("incorrect version ordering")
	}
}

func TestCheck(t *testing.T) {
	for _, tc := range []struct {
		name, body, status, latest string
		code                       int
	}{
		{"newer", `[{"name":"v1.9.0"},{"name":"v1.10.0"},{"name":"v2.0.0-rc1"}]`, "available", "1.10.0", 200},
		{"current", `[{"name":"v1.0.0"},{"name":"0.9.0"}]`, "current", "1.0.0", 200},
		{"unpublished", `[]`, "no_releases", "", 200},
		{"prerelease", `[{"name":"v1.1.0-beta"}]`, "no_releases", "", 200},
		{"missing", `{}`, "unavailable", "", 404},
		{"rate limited", `{}`, "unavailable", "", 403},
		{"invalid", `null`, "unavailable", "", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" || r.Header.Get("Referer") != "" {
					t.Error("private request metadata sent")
				}
				if r.URL.RawQuery != "per_page=100&page=1" {
					t.Error("unexpected query")
				}
				w.WriteHeader(tc.code)
				fmt.Fprint(w, tc.body)
			}))
			defer upstream.Close()
			c := New("1.0.0")
			c.endpoint = upstream.URL
			var wg sync.WaitGroup
			for range 8 {
				wg.Go(func() {
					result := c.Check()
					if result.Status != tc.status || result.Latest != tc.latest || result.Current != "1.0.0" || result.CheckedAt.IsZero() {
						t.Errorf("unexpected result %+v", result)
					}
				})
			}
			wg.Wait()
			if calls.Load() != 1 {
				t.Errorf("upstream called %d times", calls.Load())
			}
		})
	}
}

func TestPagination(t *testing.T) {
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Query().Get("page") == "1" {
			w.Header().Set("Link", `<https://untrusted.invalid/>; rel="next"`)
			fmt.Fprint(w, `[{"name":"v1.0.0"}]`)
		} else {
			fmt.Fprint(w, `[{"name":"v2.0.0"}]`)
		}
	}))
	defer upstream.Close()
	c := New("1.0.0")
	c.endpoint = upstream.URL
	result := c.Check()
	if result.Status != "available" || result.URL != Repository+"/tree/v2.0.0" || calls != 2 {
		t.Fatalf("unexpected result %+v calls %d", result, calls)
	}
}

func TestPaginationLimit(t *testing.T) {
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Link", `<https://untrusted.invalid/>; rel="next"`)
		fmt.Fprint(w, `[{"name":"v1.0.0"}]`)
	}))
	defer upstream.Close()
	c := New("1.0.0")
	c.endpoint = upstream.URL
	if result := c.Check(); result.Status != "unavailable" || calls != 10 {
		t.Fatalf("unexpected result %+v calls %d", result, calls)
	}
}
