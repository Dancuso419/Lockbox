package main

import (
	"context"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/flare-foundation/go-flare-common/pkg/logger"

	"extension-scaffold/internal/allocations"
	"extension-scaffold/internal/chain"
	"extension-scaffold/internal/config"
	extension "extension-scaffold/internal/extension"
	"extension-scaffold/internal/signer"
)

func main() {
	sgn, err := signer.NewFromHex(config.SigningKeyHex(), big.NewInt(config.ChainID()))
	if err != nil {
		logger.Fatalf("signer: %v", err)
	}
	store := allocations.New()
	rdr, err := chain.Dial(config.ChainURL())
	if err != nil {
		logger.Fatalf("chain dial: %v", err)
	}
	e := extension.New(config.ExtensionPort, config.SignPort, sgn, store, rdr)

	// Graceful shutdown.
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		ctx, cancel := context.WithTimeout(context.Background(), config.TimeoutShutdown)
		defer cancel()
		if err := e.Server.Shutdown(ctx); err != nil {
			logger.Errorf("graceful shutdown: %v", err)
		}
		os.Exit(0)
	}()

	logger.Infof("starting extension server on :%d", config.ExtensionPort)
	err = e.Server.ListenAndServe()
	if err != nil && err != http.ErrServerClosed {
		logger.Fatalf("server: %v", err)
	}
}
