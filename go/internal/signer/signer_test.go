package signer

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// A fixed test key (NOT for real funds).
const testKeyHex = "353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73"

func TestSignVoucher_RecoversToSignerAddress(t *testing.T) {
	s, err := NewFromHex(testKeyHex, big.NewInt(114))
	if err != nil {
		t.Fatalf("NewFromHex: %v", err)
	}

	pool := common.HexToAddress("0xB91c743E0c9FD6068f1833759a146E950312955B")
	recipient := common.HexToAddress("0x000000000000000000000000000000000000bEEF")
	amount := big.NewInt(3_000_000_000_000_000_000)
	nonce := big.NewInt(1)

	sig, err := s.SignVoucher(pool, recipient, amount, nonce)
	if err != nil {
		t.Fatalf("SignVoucher: %v", err)
	}
	if len(sig) != 65 {
		t.Fatalf("sig len = %d, want 65", len(sig))
	}
	if v := sig[64]; v != 27 && v != 28 {
		t.Fatalf("V = %d, want 27 or 28", v)
	}

	digest := s.voucherDigest(pool, recipient, amount, nonce)
	recovered, err := crypto.SigToPub(digest, sigWithV0(sig))
	if err != nil {
		t.Fatalf("SigToPub: %v", err)
	}
	if got := crypto.PubkeyToAddress(*recovered); got != s.Address() {
		t.Fatalf("recovered %s, want %s", got, s.Address())
	}
}

// helper: crypto.SigToPub needs V in {0,1}
func sigWithV0(sig []byte) []byte {
	c := make([]byte, 65)
	copy(c, sig)
	c[64] -= 27
	return c
}
