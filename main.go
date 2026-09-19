// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Package main starts the embedded swissPaste application
package main

import (
	"context"
	"crypto/tls"
	"embed"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/swissmakers/swisspaste/internal/config"
	"github.com/swissmakers/swisspaste/internal/server"
	"github.com/swissmakers/swisspaste/internal/session"
	"github.com/swissmakers/swisspaste/web"
)

//go:embed VERSION LICENSE
var metadata embed.FS

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	mgr, err := session.NewManager(cfg.DataDir, session.Limits{
		PeerInsights:          cfg.PeerInsights,
		MaxSessions:           cfg.MaxSessions,
		MaxPeers:              cfg.MaxPeers,
		MaxTotalUploadBytes:   cfg.MaxTotalUploadBytes,
		MaxTotalTextBytes:     cfg.MaxTotalTextBytes,
		MaxTextBytes:          cfg.MaxTextBytes,
		MaxFilesPerSession:    cfg.MaxFilesPerSession,
		MaxSessionUploadBytes: cfg.MaxSessionUploadBytes,
		FileTTL:               cfg.FileTTL,
		SessionTTL:            cfg.SessionTTL,
	})
	if err != nil {
		log.Error("init session manager", "err", err)
		os.Exit(1)
	}
	mgr.StartJanitor(30 * time.Second)

	version, _ := metadata.ReadFile("VERSION")
	license, _ := metadata.ReadFile("LICENSE")
	srv := server.New(cfg, mgr, log, web.Index(), web.Static(), strings.TrimSpace(string(version)), license)

	httpSrv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		ReadTimeout:       30 * time.Minute,
		WriteTimeout:      30 * time.Minute,
		MaxHeaderBytes:    16 << 10,
		TLSConfig:         &tls.Config{MinVersion: tls.VersionTLS12},

		ErrorLog: slog.NewLogLogger(log.Handler(), slog.LevelError),
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var serveFailed atomic.Bool
	go func() {
		log.Info("swisspaste listening",
			"addr", cfg.ListenAddr,
			"version", strings.TrimSpace(string(version)),
			"tls", cfg.TLSCertFile != "",
			"fileTTL", cfg.FileTTL.String(),
			"sessionTTL", cfg.SessionTTL.String(),
			"maxUpload", cfg.MaxUploadBytes,
		)
		var serveErr error
		if cfg.TLSCertFile != "" {
			serveErr = httpSrv.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile)
		} else {
			serveErr = httpSrv.ListenAndServe()
		}
		if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			serveFailed.Store(true)
			log.Error("server stopped", "err", serveErr)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Error("graceful shutdown failed", "err", err)
	}

	mgr.Stop()
	mgr.Shutdown()
	log.Info("bye")
	if serveFailed.Load() {
		os.Exit(1)
	}
}
