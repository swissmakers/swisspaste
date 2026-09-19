// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Bridge session updates to bounded WebSocket connections
package server

import (
	"encoding/json"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/swissmakers/swisspaste/internal/session"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	sendBuffer     = 16
	readLimitSlack = 4096
)

type client struct {
	conn    *websocket.Conn
	sess    *session.Session
	send    chan []byte
	done    chan struct{}
	closeMu sync.Once

	metaMu      sync.Mutex
	meta        session.PeerMeta
	insights    bool
	queuedBytes *atomic.Int64
	sendMu      sync.Mutex
	stopped     bool
}

type incoming struct {
	Type     string `json:"type"`
	Content  string `json:"content"`
	Language string `json:"language"`

	Timezone  string   `json:"timezone"`
	Languages []string `json:"languages"`
	Screen    string   `json:"screen"`
	Platform  string   `json:"platform"`
}

func (c *client) Meta() session.PeerMeta {
	c.metaMu.Lock()
	defer c.metaMu.Unlock()
	return c.meta
}

func (c *client) applyReported(in incoming) {
	c.metaMu.Lock()
	c.meta.Timezone = clampStr(in.Timezone, 64)
	c.meta.Platform = clampStr(in.Platform, 64)
	c.meta.Screen = clampStr(in.Screen, 32)
	langs := in.Languages
	if len(langs) > 8 {
		langs = langs[:8]
	}
	for i := range langs {
		langs[i] = clampStr(langs[i], 16)
	}
	c.meta.Languages = langs
	c.metaMu.Unlock()
}

func clampStr(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	select {
	case s.connections <- struct{}{}:
		defer func() { <-s.connections }()
	default:
		http.Error(w, "connection capacity reached", http.StatusServiceUnavailable)
		return
	}
	code := r.PathValue("code")
	sess, err := s.mgr.Get(code)
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	c := &client{
		conn:        conn,
		sess:        sess,
		send:        make(chan []byte, sendBuffer),
		done:        make(chan struct{}),
		meta:        s.buildPeerMeta(r),
		insights:    s.cfg.PeerInsights,
		queuedBytes: &s.queuedBytes,
	}
	conn.SetReadLimit(6*s.cfg.MaxTextBytes + readLimitSlack)

	if err := sess.Join(c); err != nil {
		c.Close()
		return
	}
	go c.writePump()
	c.readPump()
}

func (c *client) Close() { c.closeMu.Do(func() { _ = c.conn.Close() }) }

func (c *client) Send(msg []byte) {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if c.stopped {
		return
	}
	size := int64(len(msg))
	if c.queuedBytes.Add(size) > 128<<20 {
		c.queuedBytes.Add(-size)
		c.Close()
		return
	}
	select {
	case c.send <- msg:
	default:
		c.queuedBytes.Add(-size)
		c.Close()
	}
}

func (c *client) readPump() {
	defer func() {
		c.sess.Leave(c)
		close(c.done)
		_ = c.conn.Close()
	}()

	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	window := time.Now()
	messages := 0
	helloSeen := false
	for {
		mt, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if !c.sess.Active() {
			return
		}
		if time.Since(window) >= time.Second {
			window = time.Now()
			messages = 0
		}
		messages++
		if messages > 30 {
			return
		}
		if mt != websocket.TextMessage {
			continue
		}
		var msg incoming
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == "text" {

			if err := c.sess.SetText(msg.Content, c); err != nil {
				reply, _ := json.Marshal(map[string]string{"type": "error", "error": err.Error()})
				c.Send(reply)
			}
			continue
		}
		if msg.Type == "language" {
			if err := c.sess.SetLanguage(msg.Language); err != nil {
				reply, _ := json.Marshal(map[string]string{"type": "language_error", "error": err.Error()})
				c.Send(reply)
			}
			continue
		}
		if msg.Type == "hello" && c.insights && !helloSeen {
			helloSeen = true
			c.applyReported(msg)
			c.sess.BroadcastRoster()
		}
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
		// Leave synchronizes with broadcasts before draining the abandoned queue
		c.sess.Leave(c)
		c.sendMu.Lock()
		defer c.sendMu.Unlock()
		c.stopped = true
		for {
			select {
			case msg := <-c.send:
				c.queuedBytes.Add(-int64(len(msg)))
			default:
				return
			}
		}
	}()

	for {
		select {
		case msg := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			err := c.conn.WriteMessage(websocket.TextMessage, msg)
			c.queuedBytes.Add(-int64(len(msg)))
			if err != nil {
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.done:
			return
		}
	}
}
