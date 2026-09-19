// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Package session manages ephemeral documents and reserved file storage
package session

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

const CodeLength = 16

var (
	ErrCapacity     = errors.New("server capacity reached")
	ErrNotFound     = errors.New("session not found")
	ErrTextTooLarge = errors.New("paste exceeds maximum size")
	ErrTooManyFiles = errors.New("session file limit reached")
	ErrSessionFull  = errors.New("session storage limit reached")
	ErrLanguage     = errors.New("unsupported editor language")
)

type Subscriber interface {
	Send(msg []byte)
	Meta() PeerMeta
	Close()
}

type PeerMeta struct {
	ID       string `json:"id"`
	IP       string `json:"ip,omitempty"`
	JoinedAt int64  `json:"joinedAt"`

	OS             string `json:"os,omitempty"`
	OSVersion      string `json:"osVersion,omitempty"`
	Browser        string `json:"browser,omitempty"`
	BrowserVersion string `json:"browserVersion,omitempty"`
	Device         string `json:"device,omitempty"`
	Mobile         bool   `json:"mobile,omitempty"`
	Bot            bool   `json:"bot,omitempty"`
	UserAgent      string `json:"userAgent,omitempty"`

	Country     string  `json:"country,omitempty"`
	CountryCode string  `json:"countryCode,omitempty"`
	Region      string  `json:"region,omitempty"`
	City        string  `json:"city,omitempty"`
	Lat         float64 `json:"lat,omitempty"`
	Lon         float64 `json:"lon,omitempty"`

	Timezone  string   `json:"timezone,omitempty"`
	Languages []string `json:"languages,omitempty"`
	Screen    string   `json:"screen,omitempty"`
	Platform  string   `json:"platform,omitempty"`
}

type File struct {
	ID         string
	Name       string
	Size       int64
	UploadedAt time.Time

	diskPath string
}

type Limits struct {
	PeerInsights          bool
	MaxSessions           int
	MaxPeers              int
	MaxTotalUploadBytes   int64
	MaxTotalTextBytes     int64
	MaxTextBytes          int64
	MaxFilesPerSession    int
	MaxSessionUploadBytes int64
	FileTTL               time.Duration
	SessionTTL            time.Duration
}

type Session struct {
	Code      string
	CreatedAt time.Time

	mu       sync.RWMutex
	text     string
	language string
	rev      int64
	files    map[string]*File
	subs     map[Subscriber]struct{}
	bytes    int64
	limits   Limits
	closed   bool
	pending  int
	reserved int64
	mgr      *Manager
}

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	dataDir  string
	limits   Limits

	stop      chan struct{}
	stopOnce  sync.Once
	budgetMu  sync.Mutex
	fileBytes int64
	textBytes int64
}

func NewManager(dataDir string, limits Limits) (*Manager, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	// A private per-process directory protects session codes even on a shared tmpfs
	privateDir, err := os.MkdirTemp(dataDir, "swisspaste-")
	if err != nil {
		return nil, fmt.Errorf("create private spool: %w", err)
	}
	if limits.MaxSessions <= 0 {
		limits.MaxSessions = 256
	}
	if limits.MaxPeers <= 0 {
		limits.MaxPeers = 32
	}
	if limits.MaxTotalUploadBytes <= 0 {
		limits.MaxTotalUploadBytes = 4 << 30
	}
	if limits.MaxTotalTextBytes <= 0 {
		limits.MaxTotalTextBytes = 256 << 20
	}
	return &Manager{
		sessions: make(map[string]*Session),
		dataDir:  privateDir,
		limits:   limits,
		stop:     make(chan struct{}),
	}, nil
}

func (m *Manager) Create() (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sessions) >= m.limits.MaxSessions {
		return nil, ErrCapacity
	}
	for attempts := 0; attempts < 8; attempts++ {
		code, err := generateCode()
		if err != nil {
			return nil, err
		}
		if _, exists := m.sessions[code]; exists {
			continue
		}
		s := &Session{
			Code:      code,
			CreatedAt: time.Now(),
			files:     make(map[string]*File),
			subs:      make(map[Subscriber]struct{}),
			limits:    m.limits,
			mgr:       m,
		}
		m.sessions[code] = s
		return s, nil
	}
	return nil, errors.New("could not allocate a unique session code")
}

func (m *Manager) Get(code string) (*Session, error) {
	if !ValidCode(code) {
		return nil, ErrNotFound
	}
	m.mu.RLock()
	s, ok := m.sessions[code]
	m.mu.RUnlock()
	if !ok || !s.Active() {
		return nil, ErrNotFound
	}
	return s, nil
}

func (m *Manager) spoolPath(code, id string) string {
	return filepath.Join(m.dataDir, id)
}

func (m *Manager) StartJanitor(interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-m.stop:
				return
			case <-ticker.C:
				m.sweep(time.Now())
			}
		}
	}()
}

func (m *Manager) Stop() { m.stopOnce.Do(func() { close(m.stop) }) }

func (m *Manager) sweep(now time.Time) {

	m.mu.RLock()
	all := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.mu.RUnlock()

	var expiredSessions []*Session
	for _, s := range all {
		if now.Sub(s.CreatedAt) >= s.limits.SessionTTL {
			expiredSessions = append(expiredSessions, s)
			continue
		}
		s.expireFiles(now)
	}

	for _, s := range expiredSessions {
		s.shred()
		m.mu.Lock()
		delete(m.sessions, s.Code)
		m.mu.Unlock()
	}
}

func (m *Manager) Shutdown() {
	defer os.RemoveAll(m.dataDir)
	m.mu.Lock()
	defer m.mu.Unlock()
	for code, s := range m.sessions {
		s.shred()
		delete(m.sessions, code)
	}
}

func (s *Session) activeLocked() bool {
	return !s.closed && time.Now().Before(s.CreatedAt.Add(s.limits.SessionTTL))
}

func (s *Session) Active() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.activeLocked()
}

func (s *Session) Join(sub Subscriber) error {
	s.mu.Lock()
	if !s.activeLocked() {
		s.mu.Unlock()
		return ErrNotFound
	}
	if len(s.subs) >= s.limits.MaxPeers {
		s.mu.Unlock()
		return ErrCapacity
	}
	s.subs[sub] = struct{}{}
	sub.Send(s.snapshotLocked(sub))
	s.mu.Unlock()
	s.broadcastRoster()
	return nil
}

func (s *Session) Leave(sub Subscriber) {
	s.mu.Lock()
	delete(s.subs, sub)
	s.mu.Unlock()
	s.broadcastRoster()
}

func (s *Session) BroadcastRoster() { s.broadcastRoster() }

func (s *Session) SetText(content string, origin Subscriber) error {
	if int64(len(content)) > s.limits.MaxTextBytes {
		return ErrTextTooLarge
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.activeLocked() {
		return ErrNotFound
	}
	delta := int64(len(content) - len(s.text))
	s.mgr.budgetMu.Lock()
	if delta > s.limits.MaxTotalTextBytes-s.mgr.textBytes {
		s.mgr.budgetMu.Unlock()
		return ErrCapacity
	}
	s.mgr.textBytes += delta
	s.mgr.budgetMu.Unlock()
	s.text = content
	s.rev++
	msg, _ := json.Marshal(wireMessage{Type: "text", Content: &content, Rev: s.rev})
	// Lock acknowledgements with broadcasts so clients observe revisions in acceptance order
	ack, _ := json.Marshal(wireMessage{Type: "ack", Content: &content, Rev: s.rev})
	for sub := range s.subs {
		if sub == origin {
			sub.Send(ack)
		} else {
			sub.Send(msg)
		}
	}
	return nil
}

// SetLanguage broadcasts under the session lock to preserve acceptance order
func (s *Session) SetLanguage(language string) error {
	switch language {
	case "", "javascript", "application/json", "text/typescript", "htmlmixed", "css", "xml", "markdown", "python", "text/x-go", "rust", "text/x-php", "text/x-java", "text/x-csrc", "text/x-c++src", "text/x-csharp", "shell", "yaml", "text/x-sql", "dockerfile", "text/x-properties", "nginx", "powershell", "diff", "ruby", "perl", "lua", "toml":
	default:
		return ErrLanguage
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.activeLocked() {
		return ErrNotFound
	}
	s.language = language
	msg, _ := json.Marshal(wireMessage{Type: "language", Language: &language})
	for sub := range s.subs {
		sub.Send(msg)
	}
	return nil
}

// Unknown lengths reserve the request cap until committed to a file or released
// Release must be called on every path
type Reservation struct {
	s    *Session
	size int64
	done bool
}

func (s *Session) ReserveFile(size int64) (*Reservation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.activeLocked() {
		return nil, ErrNotFound
	}
	if len(s.files)+s.pending >= s.limits.MaxFilesPerSession {
		return nil, ErrTooManyFiles
	}
	if size < 0 || size > s.limits.MaxSessionUploadBytes-s.bytes-s.reserved {
		return nil, ErrSessionFull
	}
	s.mgr.budgetMu.Lock()
	defer s.mgr.budgetMu.Unlock()
	if size > s.limits.MaxTotalUploadBytes-s.mgr.fileBytes {
		return nil, ErrCapacity
	}
	s.mgr.fileBytes += size
	s.pending++
	s.reserved += size
	return &Reservation{s: s, size: size}, nil
}

func (r *Reservation) Release() {
	s := r.s
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.done {
		return
	}
	r.done = true
	s.pending--
	s.reserved -= r.size
	s.mgr.budgetMu.Lock()
	s.mgr.fileBytes -= r.size
	s.mgr.budgetMu.Unlock()
}

func (r *Reservation) Commit(f *File) error {
	s := r.s
	s.mu.Lock()
	if r.done || !s.activeLocked() {
		s.mu.Unlock()
		return ErrNotFound
	}
	if f.Size < 0 || f.Size > r.size {
		s.mu.Unlock()
		return ErrSessionFull
	}
	r.done = true
	s.pending--
	s.reserved -= r.size
	s.mgr.budgetMu.Lock()
	s.mgr.fileBytes -= r.size - f.Size
	s.mgr.budgetMu.Unlock()
	s.files[f.ID] = f
	s.bytes += f.Size
	s.mu.Unlock()
	s.broadcastFiles()
	return nil
}

func (s *Session) releaseFileLocked(f *File) {
	_ = os.Remove(f.diskPath)
	delete(s.files, f.ID)
	s.bytes -= f.Size
	s.mgr.budgetMu.Lock()
	s.mgr.fileBytes -= f.Size
	s.mgr.budgetMu.Unlock()
}

func (s *Session) File(id string) (*File, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	f, ok := s.files[id]
	return f, ok && s.activeLocked() && time.Now().Before(f.UploadedAt.Add(s.limits.FileTTL))
}

func (f *File) DiskPath() string { return f.diskPath }

func (s *Session) DeleteFile(id string) bool {
	s.mu.Lock()
	f, ok := s.files[id]
	if ok {
		s.releaseFileLocked(f)
	}
	s.mu.Unlock()
	if ok {
		s.broadcastFiles()
	}
	return ok
}

func (s *Session) expireFiles(now time.Time) {
	s.mu.Lock()
	var removed bool
	for _, f := range s.files {
		if now.Sub(f.UploadedAt) >= s.limits.FileTTL {
			s.releaseFileLocked(f)
			removed = true
		}
	}
	s.mu.Unlock()
	if removed {
		s.broadcastFiles()
	}
}

func (s *Session) shred() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	for _, f := range s.files {
		s.releaseFileLocked(f)
	}
	s.mgr.budgetMu.Lock()
	s.mgr.textBytes -= int64(len(s.text))
	s.mgr.budgetMu.Unlock()
	s.files = make(map[string]*File)
	s.bytes = 0
	s.text = ""
	s.language = ""
	subs := make([]Subscriber, 0, len(s.subs))
	for sub := range s.subs {
		subs = append(subs, sub)
	}
	s.subs = make(map[Subscriber]struct{})
	s.mu.Unlock()

	msg, _ := json.Marshal(wireMessage{Type: "expired"})
	for _, sub := range subs {
		sub.Send(msg)
		sub.Close()
	}
}

type wireMessage struct {
	Type      string     `json:"type"`
	Content   *string    `json:"content,omitempty"`
	Language  *string    `json:"language,omitempty"`
	Rev       int64      `json:"rev,omitempty"`
	Files     []fileMeta `json:"files,omitempty"`
	Peers     int        `json:"peers"`
	Roster    []PeerMeta `json:"roster,omitempty"`
	SelfID    string     `json:"selfId,omitempty"`
	ExpiresAt int64      `json:"expiresAt,omitempty"`
	FileTTLMs int64      `json:"fileTtlMs,omitempty"`
	ServerNow int64      `json:"serverNow,omitempty"`
}

type fileMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	ExpiresAt int64  `json:"expiresAt"`
}

func (s *Session) filesMetaLocked() []fileMeta {
	out := make([]fileMeta, 0, len(s.files))
	for _, f := range s.files {
		if !time.Now().Before(f.UploadedAt.Add(s.limits.FileTTL)) {
			continue
		}
		out = append(out, fileMeta{
			ID:        f.ID,
			Name:      f.Name,
			Size:      f.Size,
			ExpiresAt: f.UploadedAt.Add(s.limits.FileTTL).UnixMilli(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ExpiresAt < out[j].ExpiresAt })
	return out
}

func (s *Session) rosterLocked() []PeerMeta {
	if !s.limits.PeerInsights {
		return nil
	}
	out := make([]PeerMeta, 0, len(s.subs))
	for sub := range s.subs {
		out = append(out, sub.Meta())
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].JoinedAt != out[j].JoinedAt {
			return out[i].JoinedAt < out[j].JoinedAt
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (s *Session) snapshotLocked(self Subscriber) []byte {
	content := s.text
	language := s.language
	msg := wireMessage{
		Type:      "init",
		Content:   &content,
		Language:  &language,
		Rev:       s.rev,
		Files:     s.filesMetaLocked(),
		Peers:     len(s.subs),
		Roster:    s.rosterLocked(),
		SelfID:    self.Meta().ID,
		ExpiresAt: s.CreatedAt.Add(s.limits.SessionTTL).UnixMilli(),
		FileTTLMs: s.limits.FileTTL.Milliseconds(),
		ServerNow: time.Now().UnixMilli(),
	}
	b, _ := json.Marshal(msg)
	return b
}

func (s *Session) broadcastFiles() {
	s.mu.RLock()
	msg, _ := json.Marshal(wireMessage{Type: "files", Files: s.filesMetaLocked(), Peers: len(s.subs)})
	for sub := range s.subs {
		sub.Send(msg)
	}
	s.mu.RUnlock()
}

func (s *Session) broadcastRoster() {
	s.mu.RLock()
	msg, _ := json.Marshal(wireMessage{Type: "roster", Peers: len(s.subs), Roster: s.rosterLocked()})
	for sub := range s.subs {
		sub.Send(msg)
	}
	s.mu.RUnlock()
}

func NewFileID() (string, error) { return randomString(20) }

func NewPeerID() string {
	id, err := randomString(12)
	if err != nil {

		return fmt.Sprintf("p%d", time.Now().UnixNano())
	}
	return id
}

func (m *Manager) SpoolPath(code, id string) string { return m.spoolPath(code, id) }

func (m *Manager) MakeFile(code, id, name string, size int64) *File {
	return &File{
		ID:         id,
		Name:       name,
		Size:       size,
		UploadedAt: time.Now(),
		diskPath:   m.spoolPath(code, id),
	}
}

func ValidCode(code string) bool {
	if len(code) != CodeLength {
		return false
	}
	for i := 0; i < len(code); i++ {
		if !inAlphabet(code[i]) {
			return false
		}
	}
	return true
}

func inAlphabet(b byte) bool {
	for i := 0; i < len(codeAlphabet); i++ {
		if codeAlphabet[i] == b {
			return true
		}
	}
	return false
}

func generateCode() (string, error) {
	out := make([]byte, CodeLength)
	max := big.NewInt(int64(len(codeAlphabet)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = codeAlphabet[n.Int64()]
	}
	return string(out), nil
}

func randomString(n int) (string, error) {
	const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	out := make([]byte, n)
	max := big.NewInt(int64(len(alpha)))
	for i := range out {
		k, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = alpha[k.Int64()]
	}
	return string(out), nil
}
