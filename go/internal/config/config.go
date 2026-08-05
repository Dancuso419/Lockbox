// Package config contains configuration values and defaults used by the extension.
package config

import (
	"os"
	"strconv"
	"time"
)

const (
	Version = "0.2.0"

	OPTypePrizePool           = "PRIZEPOOL"
	OPCommandSubmitAllocation = "SUBMIT_ALLOCATION"
	OPCommandClaimVerify      = "CLAIM_VERIFY"

	TimeoutShutdown = 5 * time.Second
)

// Defaults.
var (
	ExtensionPort = 8080
	SignPort      = 9090
)

// Environment variables override defaults.
func init() {
	ep := os.Getenv("EXTENSION_PORT")
	sp := os.Getenv("SIGN_PORT")

	if ep != "" {
		if v, err := strconv.Atoi(ep); err == nil {
			ExtensionPort = v
		}
	}
	if sp != "" {
		if v, err := strconv.Atoi(sp); err == nil {
			SignPort = v
		}
	}
}

// SigningKeyHex returns the configured voucher signing key (hex, no 0x needed).
func SigningKeyHex() string { return os.Getenv("VOUCHER_SIGNING_KEY") }

// ChainURL returns the RPC endpoint for on-chain reads.
func ChainURL() string {
	if v := os.Getenv("CHAIN_URL"); v != "" {
		return v
	}
	return "https://coston2-api.flare.network/ext/C/rpc"
}

// ChainID is the EVM chain id vouchers are bound to (Coston2 = 114).
func ChainID() int64 {
	if v := os.Getenv("CHAIN_ID"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return 114
}
