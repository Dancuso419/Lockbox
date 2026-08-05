package chain

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestTotalDepositedCalldata(t *testing.T) {
	cd := totalDepositedCalldata()
	if len(cd) != 4 {
		t.Fatalf("calldata len %d, want 4", len(cd))
	}
	// Recompute the expected 4-byte selector independently and compare.
	exp := selector("totalDeposited()")
	if common.Bytes2Hex(cd) != common.Bytes2Hex(exp) {
		t.Fatalf("selector %x != %x", cd, exp)
	}
}
