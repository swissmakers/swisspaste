// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Verify session behavior and resource boundaries
package session

import (
	"encoding/json"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLanguageBroadcastSnapshotAndIsolation(t *testing.T) {
	m := testManager(t, nil)
	a, _ := m.Create()
	b, _ := m.Create()
	first, second := &testSubscriber{}, &testSubscriber{}
	if err := a.Join(first); err != nil {
		t.Fatal(err)
	}
	if err := a.SetText("sample", nil); err != nil {
		t.Fatal(err)
	}
	if err := a.SetLanguage("text/x-go"); err != nil {
		t.Fatal(err)
	}
	var message map[string]any
	if err := json.Unmarshal(first.messages[len(first.messages)-1], &message); err != nil {
		t.Fatal(err)
	}
	if message["type"] != "language" || message["language"] != "text/x-go" {
		t.Fatalf("language was not broadcast: %v", message)
	}
	if err := a.Join(second); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(second.messages[0], &message); err != nil {
		t.Fatal(err)
	}
	if message["language"] != "text/x-go" || message["content"] != "sample" || message["rev"] != float64(1) {
		t.Fatalf("snapshot lost language or changed text: %v", message)
	}
	if err := a.SetLanguage("<script>"); !errors.Is(err, ErrLanguage) {
		t.Fatal("unsupported mode accepted")
	}
	if a.language != "text/x-go" || b.language != "" {
		t.Fatal("invalid update or cross-session language leak")
	}
	if err := a.SetLanguage(""); err != nil {
		t.Fatal(err)
	}
	message = nil
	if err := json.Unmarshal(first.messages[len(first.messages)-1], &message); err != nil {
		t.Fatal(err)
	}
	if value, ok := message["language"]; !ok || value != "" {
		t.Fatal("plain text update omitted")
	}
	a.CreatedAt = time.Now().Add(-2 * time.Hour)
	if err := a.SetLanguage("python"); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired session accepted language update")
	}
}

func testManager(t *testing.T, configure func(*Limits)) *Manager {
	t.Helper()
	limits := Limits{MaxTextBytes: 1024, MaxFilesPerSession: 2, MaxSessionUploadBytes: 10, FileTTL: time.Hour, SessionTTL: time.Hour, MaxTotalUploadBytes: 12, MaxTotalTextBytes: 12}
	if configure != nil {
		configure(&limits)
	}
	m, err := NewManager(t.TempDir(), limits)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Shutdown)
	return m
}

func TestConcurrentReservationsAndRelease(t *testing.T) {
	m := testManager(t, nil)
	s, _ := m.Create()
	var wg sync.WaitGroup
	var accepted atomic.Int32
	reservations := make(chan *Reservation, 20)
	for range 20 {
		wg.Go(func() {
			r, err := s.ReserveFile(5)
			if err == nil {
				accepted.Add(1)
				reservations <- r
			}
		})
	}
	wg.Wait()
	close(reservations)
	if accepted.Load() != 2 {
		t.Fatalf("accepted %d simultaneous uploads", accepted.Load())
	}
	for r := range reservations {
		r.Release()
		r.Release()
	}
	if s.pending != 0 || s.reserved != 0 || m.fileBytes != 0 {
		t.Fatal("reservation leaked")
	}
}

func TestGlobalStorageAndTextBudgets(t *testing.T) {
	m := testManager(t, nil)
	a, _ := m.Create()
	b, _ := m.Create()
	r, err := a.ReserveFile(8)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Release()
	if _, err = b.ReserveFile(5); !errors.Is(err, ErrCapacity) {
		t.Fatalf("global limit bypass: %v", err)
	}
	f := m.MakeFile(a.Code, "test", "name", 8)
	if err = r.Commit(f); err != nil {
		t.Fatal(err)
	}
	r.Release()
	if m.fileBytes != 8 {
		t.Fatal("committed budget released")
	}
	a.DeleteFile(f.ID)
	if m.fileBytes != 0 {
		t.Fatal("deleted budget retained")
	}
	if err = a.SetText("12345678", nil); err != nil {
		t.Fatal(err)
	}
	if err = b.SetText("12345", nil); !errors.Is(err, ErrCapacity) {
		t.Fatal("global text budget bypass")
	}
	a.shred()
	if err = b.SetText("12345", nil); err != nil {
		t.Fatal(err)
	}
}

func TestExpiryRejectsAccessAndInFlightCommit(t *testing.T) {
	m := testManager(t, nil)
	s, _ := m.Create()
	r, _ := s.ReserveFile(1)
	defer r.Release()
	f := m.MakeFile(s.Code, "file", "x", 1)
	if err := os.WriteFile(f.DiskPath(), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	s.CreatedAt = time.Now().Add(-2 * time.Hour)
	if _, err := m.Get(s.Code); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired session accessible before janitor")
	}
	if err := s.SetText("x", nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired session writable")
	}
	if err := r.Commit(f); !errors.Is(err, ErrNotFound) {
		t.Fatal("upload committed after expiry")
	}
	s.shred()
	s.shred()
	if err := s.SetText("x", nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("closed session writable")
	}
}

func TestExpiredFileInaccessibleBeforeSweep(t *testing.T) {
	m := testManager(t, nil)
	s, _ := m.Create()
	r, _ := s.ReserveFile(1)
	f := m.MakeFile(s.Code, "file", "x", 1)
	f.UploadedAt = time.Now().Add(-2 * time.Hour)
	if err := r.Commit(f); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.File(f.ID); ok {
		t.Fatal("expired file accessible")
	}
	s.expireFiles(time.Now())
	if m.fileBytes != 0 {
		t.Fatal("expired file budget leaked")
	}
}

func TestSessionCapacity(t *testing.T) {
	m := testManager(t, func(l *Limits) { l.MaxSessions = 1 })
	s, _ := m.Create()
	if _, err := m.Create(); !errors.Is(err, ErrCapacity) {
		t.Fatal("session cap bypass")
	}
	s.CreatedAt = time.Now().Add(-2 * time.Hour)
	m.sweep(time.Now())
	if _, err := m.Create(); err != nil {
		t.Fatal(err)
	}
}

type testSubscriber struct {
	mu       sync.Mutex
	messages [][]byte
	closed   bool
}

func (p *testSubscriber) Send(message []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.messages = append(p.messages, message)
}
func (*testSubscriber) Meta() PeerMeta { return PeerMeta{ID: "peer"} }
func (p *testSubscriber) Close()       { p.mu.Lock(); defer p.mu.Unlock(); p.closed = true }

func TestPeerLimitAndExpiryClosesSubscribers(t *testing.T) {
	m := testManager(t, func(l *Limits) { l.MaxPeers = 1 })
	s, _ := m.Create()
	first, second := &testSubscriber{}, &testSubscriber{}
	if err := s.Join(first); err != nil {
		t.Fatal(err)
	}
	if err := s.Join(second); !errors.Is(err, ErrCapacity) {
		t.Fatal("peer cap bypass")
	}
	s.shred()
	if !first.closed {
		t.Fatal("expired connection left open")
	}
	if err := s.Join(second); !errors.Is(err, ErrNotFound) {
		t.Fatal("joined destroyed session")
	}
}

func TestPrivateSpoolCleanup(t *testing.T) {
	m := testManager(t, nil)
	info, err := os.Stat(m.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0700 {
		t.Fatal("spool directory is not private")
	}
	m.Shutdown()
	if _, err = os.Stat(m.dataDir); !os.IsNotExist(err) {
		t.Fatal("private spool survived shutdown")
	}
}
