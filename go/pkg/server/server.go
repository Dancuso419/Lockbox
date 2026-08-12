package server

import (
	"math/big"

	"extension-scaffold/internal/allocations"
	"extension-scaffold/internal/chain"
	"extension-scaffold/internal/config"
	extension "extension-scaffold/internal/extension"
	"extension-scaffold/internal/signer"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
)

// StartExtension creates and starts the template extension server in a goroutine.
// Returns an error channel that receives any ListenAndServe failure (e.g., port already in use).
func StartExtension(extensionPort, signPort int) <-chan error {
	sgn, err := signer.NewFromHex(config.SigningKeyHex(), big.NewInt(config.ChainID()))
	if err != nil {
		logger.Fatalf("signer: %v", err)
	}
	store := allocations.New(sgn.NonceSecret())
	rdr, err := chain.Dial(config.ChainURL())
	if err != nil {
		logger.Fatalf("chain dial: %v", err)
	}
	e := extension.New(extensionPort, signPort, sgn, store, rdr)
	errCh := make(chan error, 1)
	go func() {
		if err := e.Server.ListenAndServe(); err != nil {
			errCh <- err
		}
	}()
	return errCh
}
